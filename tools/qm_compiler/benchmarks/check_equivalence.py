#!/usr/bin/env python3
"""check_equivalence.py — compare serve results across VM lanes.

Modes must match exactly; responses compare structurally (JSON equality;
numbers compared as floats with 1e-9 tolerance — the rust lane prints 0.0,
the C lane 0).

Usage: check_equivalence.py <rust_out.json> <c_out.txt> <wasm_out.txt> ...
"""
import json
import re
import sys


def load(path):
    if path.endswith(".json"):
        return json.load(open(path))["results"]
    txt = open(path).read()
    m = re.search(r"results \[\n(.*?)\n\]", txt, re.S)
    return [json.loads(l.rstrip(",")) for l in m.group(1).split("\n")]


def eq(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) < 1e-9
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(eq(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(eq(x, y) for x, y in zip(a, b))
    return a == b


def main():
    lanes = [(p.split("/")[-2], load(p)) for p in sys.argv[1:]]
    ref_name, ref = lanes[0]
    ok = True
    for name, res in lanes[1:]:
        if len(res) != len(ref):
            print(f"{name}: LENGTH MISMATCH ({len(res)} vs {len(ref)} ref)")
            ok = False
            continue
        for i, (r, c) in enumerate(zip(ref, res)):
            same = r["mode"] == c["mode"] and eq(r["response"], c["response"])
            if not same:
                print(f"{name}[{i}] {c['kind']}: rust={r['mode']}/{r['response']!r} "
                      f"vs {name}={c['mode']}/{c['response']!r}")
                ok = False
    print("cross-lane equivalence vs", ref_name, ":", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
