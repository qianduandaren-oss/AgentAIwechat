#!/usr/bin/env node
/**
 * Day 90 noon: run Day 86 disposable Linux procfs; optionally Day 89 UID lab.
 * Maps only to lab signals, not authenticated production host receipts.
 * Set DAY90_ENABLE_DAC_LAB=1 only in disposable CI/VM with sudo/setpriv.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readlinkSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapLocalLabsToCutoverUnknownMatrix } from
  "../dist/runtime/recovery-writer-cutover-local-evidence.js";

if (process.platform !== "linux") throw Error("FAIL_CLOSED: disposable Linux procfs required");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function runLab(program, args) {
  const result = spawnSync(program, args, {
    cwd: root, encoding: "utf8", timeout: 40000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, NODE_NO_WARNINGS: "1" }
  });
  if (result.error || result.status !== 0) {
    throw Error("FAIL_CLOSED: lab failed: " +
      String(result.error?.message || result.stderr || result.stdout || result.status).slice(0, 1200));
  }
  return result.stdout;
}
const text = runLab(process.execPath, [join(root, "scripts/day86-noon-host-fd-probe.mjs")]);
const marker = "DAY86_RAW_PROCFS_ARTIFACT_B64=";
const lines = text.split(/\r?\n/).filter(line => line.startsWith(marker));
assert.equal(lines.length, 1, "exactly one real procfs artifact required");
const encoded = lines[0].slice(marker.length);
assert.match(encoded, /^[A-Za-z0-9+/]+={0,2}$/);
const raw = Buffer.from(encoded, "base64");
assert.ok(raw.length > 0 && raw.length < 1024 * 1024 &&
  raw.toString("base64") === encoded);
const proc = JSON.parse(raw.toString("utf8"));
assert.equal(proc.schemaVersion, 1);
assert.equal(proc.source, "linux-procfs-owned-fixture");
assert.equal(proc.hostId, hostname());
assert.equal(proc.mountNamespaceId, readlinkSync("/proc/self/ns/mnt"));
assert.ok(Number.isSafeInteger(proc.observedAtEpochMs));
assert.ok(Number.isSafeInteger(proc.pid) && proc.pid > 0);
assert.ok(typeof proc.startTicks === "string" && proc.startTicks.length > 0);
assert.ok(typeof proc.rawProcStat === "string" && proc.rawProcStat.includes(") "));
assert.ok(Array.isArray(proc.fdSnapshots) && proc.fdSnapshots.some(fd => {
  const flags = typeof fd.rawFdinfo === "string"
    ? /^flags:\s*([0-7]+)/m.exec(fd.rawFdinfo)?.[1] : null;
  return fd.file === "/agent.sqlite" &&
    flags && [1, 2].includes(parseInt(flags, 8) & 3);
}), "real kernel fdinfo for writable SQLite FD required");
const signals = [{
  kind: "day86_owned_child_writable_sqlite_fd", phase: "preflight",
  hostId: proc.hostId, mountNamespaceId: proc.mountNamespaceId,
  observedAtEpochMs: proc.observedAtEpochMs,
  rawArtifactSha256: createHash("sha256").update(raw).digest("hex")
}];
if (process.env.DAY90_ENABLE_DAC_LAB === "1") {
  const cmd = process.getuid?.() === 0 ? process.execPath : "sudo";
  const args = process.getuid?.() === 0
    ? [join(root, "scripts/day89-noon-control-plane-os-isolation.mjs")]
    : ["-n", process.execPath, join(root, "scripts/day89-noon-control-plane-os-isolation.mjs")];
  const labText = runLab(cmd, args);
  const result = JSON.parse(labText.trim());
  assert.equal(result.action, "isolated_os_permissions_observed");
  assert.equal(result.controllerUid, 65021);
  assert.equal(result.workerUid, 65022);
  assert.equal(result.dbWalShmOwnedByController, true);
  assert.equal(result.publishAuthorized, false);
  assert.deepEqual(new Set(result.denied), new Set(["db", "-wal", "-shm", "directory-create"]));
  signals.push({
    kind: "day89_disposable_uid_new_open_denial", phase: "preflight",
    hostId: proc.hostId, mountNamespaceId: proc.mountNamespaceId,
    observedAtEpochMs: Date.now(),
    rawArtifactSha256: createHash("sha256").update(Buffer.from(labText, "utf8")).digest("hex")
  });
}
const scope = {
  deploymentId: "staging:day90-noon-local-fixture",
  releaseId: "release-day90-noon-local-fixture",
  attemptId: "not-a-real-deployment-attempt",
  expectedHosts: [
    { hostId: proc.hostId, mountNamespaceId: proc.mountNamespaceId },
    { hostId: "synthetic-unobserved-host", mountNamespaceId: "mnt:[999999]" }
  ]
};
assert.notEqual(scope.expectedHosts[0].hostId, scope.expectedHosts[1].hostId);
const report = mapLocalLabsToCutoverUnknownMatrix({ scope, nowEpochMs: Date.now(), signals });
assert.equal(report.action, "hold");
assert.equal(report.cells.length, 28);
assert.ok(report.cells.every(cell => cell.status === "unknown"));
assert.equal(report.acceptedHostReceiptCount, 0);
console.log(JSON.stringify({
  action: report.action, reason: report.reason,
  realLocalSignals: signals.map(s => s.kind),
  unknownCells: report.cells.length,
  acceptedHostReceipts: report.acceptedHostReceiptCount,
  coverageHoldReason: report.coverageHoldReason,
  unobservedHost: "synthetic-unobserved-host",
  publishAuthorized: false,
  limit: "owned /tmp procfs and UID lab only; no full-host attestation"
}, null, 2));
