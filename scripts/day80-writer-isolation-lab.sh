#!/usr/bin/env bash
# Day 80 lab: checks REAL Linux DAC denial on a disposable SQLite fixture.
# Not a container-mount / production IAM / existing-fd / rollback proof.
set -euo pipefail
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "FAIL_CLOSED: requires a Linux lab host" >&2; exit 1
fi
for cmd in sudo node mktemp chmod id; do
  command -v "$cmd" >/dev/null || { echo "FAIL_CLOSED: missing $cmd" >&2; exit 1; }
done
id nobody >/dev/null || { echo "FAIL_CLOSED: missing legacy test identity nobody" >&2; exit 1; }
dir="$(mktemp -d /tmp/day80-writer-lab.XXXXXX)"
code_dir="$(mktemp -d /tmp/day80-probe-code.XXXXXX)"
trap 'rm -rf -- "$dir" "$code_dir"' EXIT
chmod 700 "$dir"
# Runner checkouts can be non-traversable by 'nobody'. Copy ONLY the
# compiled, credential-free probe into a readable scratch directory.
source_probe="$PWD/dist/demos/day80-noon-writer-isolation-os-probe.js"
[[ -f "$source_probe" ]] || { echo "FAIL_CLOSED: build first" >&2; exit 1; }
chmod 755 "$code_dir"
cp -- "$source_probe" "$code_dir/probe.mjs"
chmod 644 "$code_dir/probe.mjs"
probe="$code_dir/probe.mjs"
[[ "$(node "$probe" seed "$dir")" == "LAB_SEEDED" ]] || exit 1
# Same-identity shortcut MUST be seen as unsafe, not accepted as isolation.
same_identity="$(node "$probe" probe "$dir")"
[[ "$same_identity" == "UNSAFE_WRITABLE file=writable directory=writable" ]] ||
  { echo "FAIL_CLOSED: positive control unexpected: $same_identity" >&2; exit 1; }
# Execute the same probe with a different REAL OS account.
# Require an explicit denial sentinel; launch failures cannot masquerade as pass.
legacy="$(sudo -n -u nobody -- "$(command -v node)" "$probe" probe "$dir")" ||
  { echo "FAIL_CLOSED: legacy probe failed to execute" >&2; exit 1; }
[[ "$legacy" == "OS_DENIED file=denied directory=denied" ]] ||
  { echo "FAIL_CLOSED: legacy writer is not isolated: $legacy" >&2; exit 1; }
echo "PASS Day 80 disposable Linux DAC lab: same UID unsafe; legacy OS identity denied"
echo "SCOPE: disposable fixture only. No proof of production mounts, existing FD, WAL/SHM, RPC, ACK, or rollback."
