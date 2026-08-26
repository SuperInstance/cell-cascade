/* qm_bench.c — run a compiled .qm program (qm2c.py output) on the REAL
 * quilt-vm-c (the 5 opcodes as C functions; nothing reimplemented).
 *
 * Serve semantics mirror qm-runner (the Rust lane) exactly:
 *   - route to "<to>:response"
 *   - first matching guard wins (kind equality + canonical-JSON subset
 *     payload_equals match — compile-time canonical strings, runtime strcmp)
 *   - hit:  qvm_effect(target, fwd, inv) + qvm_tick(1.0) — the VM's
 *           pending-effects drain IS the rule-table step
 *   - miss: effect writes {"miss":true} into the VM (results report null)
 *   - response read back via qvm_view (VIEW opcode)
 *
 * Timing protocol (CLOCK_MONOTONIC, ns):
 *   load   — program build (BIND/LINK of every op)
 *   cold   — the FIRST serve of the canonical signal, in-process
 *   warm   — next 999 serves of the same signal (mean)
 *   steady — 10,000 serves (mean / min / p50 / p99 / max)
 *
 * Then an untimed correctness pass replays the whole fixture and prints
 * one JSON result line per signal (compare vs qm-runner + the Worker).
 *
 * Build (see run_c_bench.sh):
 *   gcc -O2 -std=c99 -I<vm src> -I<build dir> -DQM_PROG_HEADER='"qm_prog.h"' \
 *       qm_bench.c <vm src>/quilt_vm.c -o qm_bench_<organism>
 */
#include "quilt_vm.h"
#include <inttypes.h>
#include <math.h>
#include <time.h>

#ifndef QM_PROG_HEADER
#error "define QM_PROG_HEADER to the generated qm_prog.h path"
#endif

/* ── generated-table shapes ── */
typedef struct { const char *key, *canon; } QmKv;
typedef struct { const char *target, *canon; } QmBind;
typedef struct { const char *from, *to, *type; } QmLink;
enum { QM_SET, QM_EXPR };
typedef struct {
    const char *target;
    const char *kind;      /* NULL = any kind */
    int n_pe;
    const QmKv *pe;        /* payload_equals entries (canon values) */
    int action;            /* QM_SET | QM_EXPR */
    const char *set_canon; /* QM_SET */
    const char *centroid;  /* QM_EXPR: bound cell names */
    const char *sigma;
} QmRule;
typedef struct { const char *name, *target; } QmViewDef;
typedef struct {
    const char *to, *kind;
    int n_payload;
    const QmKv *payload;   /* canon values */
} QmSignal;

/* the compiled program tables (see qm2c.py) */
#include QM_PROG_HEADER

static void free_str(void *p) { free(p); }

/* effect forward: install the precomputed result string into the thing */
typedef struct { char *value; } SetArg;
static void fwd_set(qvm_thing_t *t, void *arg) {
    SetArg *a = (SetArg *)arg;
    qvm_thing_set(t, a->value, free_str);
}
static void inv_set(qvm_thing_t *t, void *arg) {
    (void)arg;
    qvm_thing_set(t, NULL, NULL);
}

static uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

static int cmp_u64(const void *a, const void *b) {
    uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
    return x < y ? -1 : x > y ? 1 : 0;
}

/* canonical-JSON string scalar list parser for sigma_distance math:
 * "[1.5, 0.2]" -> doubles. Returns count, or -1 on parse failure. */
static int parse_num_array(const char *s, double *out, int max) {
    if (!s || s[0] != '[') return -1;
    int n = 0;
    const char *p = s + 1;
    while (*p && *p != ']') {
        char *end;
        double v = strtod(p, &end);
        if (end == p) return -1;
        if (n >= max) return -1;
        out[n++] = v;
        p = end;
        while (*p == ',' || *p == ' ') p++;
    }
    return (*p == ']') ? n : -1;
}

static double sigma_distance(const double *f, const double *c, const double *sg, int n) {
    double acc = 0.0;
    for (int i = 0; i < n; i++) {
        double d = (f[i] - c[i]) / sg[i];
        acc += d * d;
    }
    return sqrt(acc);
}

/* guard match: kind equality + payload_equals subset by canonical strcmp */
static int rule_matches(const QmRule *r, const QmSignal *s) {
    size_t rlen = strlen(r->target), alen = strlen(s->to);
    /* target "<to>:response" */
    if (rlen != alen + 9) return 0;
    if (strncmp(r->target, s->to, alen) != 0) return 0;
    if (strcmp(r->target + alen, ":response") != 0) return 0;
    if (r->kind && strcmp(r->kind, s->kind) != 0) return 0;
    for (int i = 0; i < r->n_pe; i++) {
        int found = 0;
        for (int j = 0; j < s->n_payload; j++) {
            if (strcmp(r->pe[i].key, s->payload[j].key) == 0 &&
                strcmp(r->pe[i].canon, s->payload[j].canon) == 0) {
                found = 1;
                break;
            }
        }
        if (!found) return 0;
    }
    return 1;
}

/* ONE serve, on the real VM. mode: "table" | "table-miss". heap shape kept. */
static void serve(qvm_t *vm, const QmSignal *s, char mode_out[16], const char **response_out) {
    const QmRule *hit = NULL;
    for (int i = 0; i < QM_N_RULES; i++) {
        if (rule_matches(&qm_rules[i], s)) { hit = &qm_rules[i]; break; }
    }
    char target[256];
    snprintf(target, sizeof target, "%s:response", s->to);

    SetArg arg;
    if (hit) {
        strcpy(mode_out, "table");
        if (hit->action == QM_SET) {
            arg.value = strdup(hit->set_canon);
        } else {
            /* sigma_distance expr: centroid/sigma read FROM THE VM */
            double c[64], sg[64], f[64];
            const char *cs = (const char *)qvm_view(vm, hit->centroid, "anyone");
            const char *ss = (const char *)qvm_view(vm, hit->sigma, "anyone");
            int cn = parse_num_array(cs, c, 64);
            int sn = parse_num_array(ss, sg, 64);
            /* features from the signal payload canon "[...]" */
            const char *fs = NULL;
            for (int j = 0; j < s->n_payload; j++)
                if (strcmp(s->payload[j].key, "features") == 0) fs = s->payload[j].canon;
            int fn = fs ? parse_num_array(fs, f, 64) : -1;
            if (cn < 0 || sn < 0 || fn < 0 || cn != sn || cn != fn) {
                fprintf(stderr, "expr error: f=%d c=%d s=%d\n", fn, cn, sn);
                exit(3);
            }
            double d = sigma_distance(f, c, sg, cn);
            char buf[64];
            snprintf(buf, sizeof buf, "{\"sigma_distance\":%.17g}", d);
            arg.value = strdup(buf);
        }
    } else {
        strcpy(mode_out, "table-miss");
        arg.value = strdup("{\"miss\":true}");
    }
    /* EFFECT + TICK on the real VM — the pending-effects drain applies it */
    qvm_effect(vm, target, fwd_set, inv_set, &arg);
    qvm_tick(vm, 1.0);
    /* table-miss reports null (the {miss:true} stays inside the VM) */
    *response_out = hit ? (const char *)qvm_view(vm, target, "anyone") : NULL;
}

/* print a canon JSON string or null */
static void print_json_or_null(const char *s) {
    if (s) printf("%s", s); else printf("null");
}

int main(void) {
    /* ── 1. load: BIND every bind, LINK every link ── */
    uint64_t t0 = now_ns();
    qvm_t *vm = qvm_new();
    for (int i = 0; i < QM_N_BINDS; i++)
        qvm_bind(vm, qm_binds[i].target,
                 qm_binds[i].canon ? strdup(qm_binds[i].canon) : NULL,
                 free_str);
    for (int i = 0; i < QM_N_LINKS; i++)
        qvm_link(vm, qm_links[i].from, qm_links[i].to, qm_links[i].type);
    uint64_t load_ns = now_ns() - t0;

    const QmSignal *canon_sig = &qm_signals[QM_CANONICAL_SIGNAL];
    char mode[16];
    const char *resp;

    /* ── 2. cold: first serve in this process ── */
    t0 = now_ns();
    serve(vm, canon_sig, mode, &resp);
    uint64_t cold_ns = now_ns() - t0;

    /* ── 3. warm: 999 more serves ── */
    for (int i = 0; i < 999; i++) serve(vm, canon_sig, mode, &resp);
    t0 = now_ns();
    for (int i = 0; i < 1000; i++) serve(vm, canon_sig, mode, &resp);
    uint64_t warm_ns = (now_ns() - t0) / 1000;

    /* ── 4. steady: 10,000 serves ── */
    enum { N = 10000 };
    static uint64_t samples[N];
    for (int i = 0; i < N; i++) {
        t0 = now_ns();
        serve(vm, canon_sig, mode, &resp);
        samples[i] = now_ns() - t0;
    }
    uint64_t sum = 0, mn = UINT64_MAX, mx = 0;
    for (int i = 0; i < N; i++) {
        sum += samples[i];
        if (samples[i] < mn) mn = samples[i];
        if (samples[i] > mx) mx = samples[i];
    }
    qsort(samples, N, sizeof(uint64_t), cmp_u64);
    uint64_t p50 = samples[N / 2], p99 = samples[(N * 99) / 100];
    double mean = (double)sum / N;

    /* ── 5. correctness pass: whole fixture, untimed ── */
    printf("results [\n");
    for (int i = 0; i < QM_N_SIGNALS; i++) {
        serve(vm, &qm_signals[i], mode, &resp);
        printf("  {\"to\": \"%s\", \"kind\": \"%s\", \"mode\": \"%s\", \"response\": ",
               qm_signals[i].to, qm_signals[i].kind, mode);
        print_json_or_null(resp);
        printf("}%s\n", i + 1 < QM_N_SIGNALS ? "," : "");
    }
    printf("]\n");

    /* views (VIEW opcode) */
    printf("views {\n");
    for (int i = 0; i < QM_N_VIEWS; i++) {
        const char *v = (const char *)qvm_view(vm, qm_view_defs[i].target, "anyone");
        printf("  \"%s\": ", qm_view_defs[i].name);
        print_json_or_null(v);
        printf("%s\n", i + 1 < QM_N_VIEWS ? "," : "");
    }
    printf("}\n");

    printf("timing {\"organism\": \"%s\", \"canonical_signal\": \"%s/%s\", "
           "\"load_ns\": %" PRIu64 ", "
           "\"cold_ns\": %" PRIu64 ", "
           "\"warm_mean_ns\": %" PRIu64 ", "
           "\"steady_mean_ns\": %.0f, \"steady_min_ns\": %" PRIu64
           ", \"steady_p50_ns\": %" PRIu64 ", \"steady_p99_ns\": %" PRIu64
           ", \"steady_max_ns\": %" PRIu64 "}\n",
           QM_ORGANISM, canon_sig->to, canon_sig->kind,
           load_ns, cold_ns, warm_ns, mean, mn, p50, p99, mx);

    qvm_free(vm);
    return 0;
}
