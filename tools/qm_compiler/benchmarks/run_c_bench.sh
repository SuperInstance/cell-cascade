#!/usr/bin/env bash
# run_c_bench.sh — build + run all four .qm modules on quilt-vm-c.
# Usage: run_c_bench.sh [vm_c_dir]   (default /home/eileen/projects/quilt-vm-c)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
QM="$HERE/.."
VM_C="${1:-/home/eileen/projects/quilt-vm-c}"
BUILD="$HERE/build_c"
mkdir -p "$BUILD"

# canonical signal index per organism (the reflex measured cold/warm/steady)
declare -A CANON=( [band-clock]=0 [cue-tokens]=0 [seamstress-eye]=0 [unheard-duke]=0 )

for name in band-clock cue-tokens seamstress-eye unheard-duke; do
  d="$BUILD/$name"; mkdir -p "$d"
  python3 "$HERE/qm2c.py" \
    "$QM/examples/$name.qm" "$QM/test/fixtures/$name.signals.json" \
    "${CANON[$name]}" "$d/qm_prog.h"
  gcc -Wall -Wextra -O2 -std=c99 -I"$VM_C/src" -I"$d" \
    -DQM_PROG_HEADER='"qm_prog.h"' \
    "$HERE/qm_bench.c" "$VM_C/src/quilt_vm.c" -lm -o "$d/qm_bench_$name"
  echo "════ $name (C / quilt-vm-c) ════"
  "$d/qm_bench_$name" | tee "$d/out.json.txt"
  echo
done
echo "C lane done. Artifacts in $BUILD/"
