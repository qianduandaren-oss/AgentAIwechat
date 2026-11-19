import { strict as assert } from "node:assert";
import { mapLocalLabsToCutoverUnknownMatrix, type Day90LocalLabSignal } from
  "../runtime/recovery-writer-cutover-local-evidence.js";
import { WRITER_RELEASE_CHECKS } from "../runtime/recovery-writer-release-evidence.js";

const now = Date.UTC(2026, 10, 19, 4);
const scope = {
  deploymentId: "staging:day90-noon", releaseId: "release-90-noon",
  attemptId: "local-fixture-attempt", expectedHosts: [
    { hostId: "fixture-host", mountNamespaceId: "mnt:[1001]" },
    { hostId: "unobserved-host", mountNamespaceId: "mnt:[1002]" }
  ]
};
const signals: Day90LocalLabSignal[] = [
  { kind: "day86_owned_child_writable_sqlite_fd", phase: "preflight",
    hostId: "fixture-host", mountNamespaceId: "mnt:[1001]",
    observedAtEpochMs: now - 2000, rawArtifactSha256: "a".repeat(64) },
  { kind: "day89_disposable_uid_new_open_denial", phase: "preflight",
    hostId: "fixture-host", mountNamespaceId: "mnt:[1001]",
    observedAtEpochMs: now - 1000, rawArtifactSha256: "b".repeat(64) }
];
const base = { scope, nowEpochMs: now, signals };
const result = mapLocalLabsToCutoverUnknownMatrix(base);
assert.equal(result.action, "hold");
assert.equal(result.reason, "disposable_fixture_not_deployment_attestation");
assert.equal(result.acceptedHostReceiptCount, 0);
assert.equal(result.localSignalCount, 2);
assert.equal(result.publishAuthorized, false);
assert.equal(result.cells.length, 2 * 2 * WRITER_RELEASE_CHECKS.length);
assert.ok(result.cells.every(row => row.status === "unknown"));
assert.equal(result.cells.filter(row => row.fixtureSignals.length).length, 2);
assert.ok(result.cells.some(row => row.hostId === "fixture-host" &&
  row.phase === "preflight" && row.check === "legacy_writable_fds_drained" &&
  row.fixtureSignals[0] === "day86_owned_child_writable_sqlite_fd"));
assert.ok(result.cells.some(row => row.hostId === "fixture-host" &&
  row.phase === "preflight" && row.check === "legacy_db_wal_shm_denied" &&
  row.fixtureSignals[0] === "day89_disposable_uid_new_open_denial"));
assert.ok(result.cells.filter(row =>
  row.hostId === "unobserved-host" || row.phase === "cutover")
  .every(row => row.fixtureSignals.length === 0 && row.status === "unknown"));
assert.ok(/^receipt_missing:/.test(result.coverageHoldReason));
const spoofed = mapLocalLabsToCutoverUnknownMatrix({
  ...base, signals: signals.map(s => ({ ...s, rawArtifactSha256: "f".repeat(64) }))
});
assert.ok(spoofed.cells.every(row => row.status === "unknown"));
assert.throws(() => mapLocalLabsToCutoverUnknownMatrix({
  ...base, signals: [{ ...signals[0], hostId: "unexpected" }]
}), /local_signal_target_invalid/);
assert.throws(() => mapLocalLabsToCutoverUnknownMatrix({
  ...base, signals: [{ ...signals[0], mountNamespaceId: "mnt:[bad]" }]
}), /local_signal_target_invalid/);
assert.throws(() => mapLocalLabsToCutoverUnknownMatrix({
  ...base, signals: [{ ...signals[0], rawArtifactSha256: "fake" }]
}), /local_signal_digest_or_freshness_invalid/);
assert.throws(() => mapLocalLabsToCutoverUnknownMatrix({
  ...base, signals: [{ ...signals[0], observedAtEpochMs: now - 300001 }]
}), /local_signal_digest_or_freshness_invalid/);
assert.throws(() => mapLocalLabsToCutoverUnknownMatrix({
  ...base, signals: [signals[0], signals[0]]
}), /local_signal_duplicate/);
assert.throws(() => mapLocalLabsToCutoverUnknownMatrix({
  ...base, scope: { ...scope, expectedHosts: [scope.expectedHosts[0], scope.expectedHosts[0]] }
}), /scope_host_invalid/);
const empty = mapLocalLabsToCutoverUnknownMatrix({ ...base, signals: [] });
assert.equal(empty.cells.length, 28);
assert.ok(empty.cells.every(row => row.fixtureSignals.length === 0 && row.status === "unknown"));
console.log("PASS Day 90 noon: 28 matrix cells stay UNKNOWN despite two local fixture signals.");
console.log("PASS: wrong host/ns, stale, malformed, duplicate and spoofed signals cannot grant PASS. Production NO_GO.");
