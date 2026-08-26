#!/usr/bin/env python3
"""cloud_bench.py — measure the cloud floor: HTTPS round trip to the
cell-cascade Worker's /signal for a table-served (sclerotic) cell.

Canonical reflex: environment -> cue-tokens:cue-ack kind "nod" -> ROGER.

Two modes:
  new   — fresh DNS+TCP+TLS+HTTP per request (the cold client)
  alive — one connection, keep-alive across requests (the warm client)

Also reports the Worker's own server-side latency_ms (which includes its
D1 round trips — the rule table itself lives in D1, NOT in the isolate).

Usage: cloud_bench.py [n_per_mode] [url]
"""
import http.client
import json
import socket
import ssl
import statistics
import sys
import time
import urllib.parse

N = int(sys.argv[1]) if len(sys.argv) > 1 else 30
URL = sys.argv[2] if len(sys.argv) > 2 else \
    "https://cell-cascade.casey-digennaro.workers.dev/signal"
BODY = json.dumps({"from": "environment", "to": "cue-tokens:cue-ack",
                   "kind": "nod", "payload": {}}).encode()

u = urllib.parse.urlparse(URL)
HOST, PORT, PATH = u.hostname, u.port or 443, u.path
CTX = ssl.create_default_context()


def percentile(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))]


def summarize(name, samples_ms, server_ms):
    print(f"{name:12s} n={len(samples_ms):3d}  "
          f"mean={statistics.mean(samples_ms):8.2f}ms  "
          f"p50={percentile(samples_ms,0.5):8.2f}ms  "
          f"min={min(samples_ms):8.2f}ms  "
          f"p99={percentile(samples_ms,0.99):8.2f}ms  "
          f"max={max(samples_ms):8.2f}ms  "
          f"server_reported={statistics.mean(server_ms):.2f}ms")


# ── mode: new connection each request ──
new_ms, srv = [], []
for i in range(N):
    t0 = time.perf_counter_ns()
    conn = http.client.HTTPSConnection(HOST, PORT, context=CTX, timeout=20)
    conn.request("POST", PATH, body=BODY,
                 headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    data = json.loads(resp.read())
    dt = (time.perf_counter_ns() - t0) / 1e6
    conn.close()
    assert resp.status == 200 and data["fired"]["mode"] == "table", data
    assert data["fired"]["response"]["ack"] == "ROGER", data
    new_ms.append(dt)
    srv.append(data["fired"]["latency_ms"])
summarize("new-conn", new_ms, srv)

# ── mode: keep-alive ──
alive_ms, srv2 = [], []
conn = http.client.HTTPSConnection(HOST, PORT, context=CTX, timeout=20)
for i in range(N):
    t0 = time.perf_counter_ns()
    conn.request("POST", PATH, body=BODY,
                 headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    data = json.loads(resp.read())
    dt = (time.perf_counter_ns() - t0) / 1e6
    assert resp.status == 200 and data["fired"]["mode"] == "table", data
    assert data["fired"]["response"]["ack"] == "ROGER", data
    alive_ms.append(dt)
    srv2.append(data["fired"]["latency_ms"])
conn.close()
summarize("keep-alive", alive_ms, srv2)

print(f"\ncloud floor (mean): new-conn {statistics.mean(new_ms):.1f}ms | "
      f"keep-alive {statistics.mean(alive_ms):.1f}ms | "
      f"server-side {statistics.mean(srv):.1f}ms (incl. D1 round trips)")
