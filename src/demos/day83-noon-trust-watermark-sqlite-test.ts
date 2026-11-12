import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteRecoveryWriterTrustWatermarkStore } from "../runtime/recovery-writer-sqlite-trust-watermark-store.js";
import { bootstrapRecoveredWriterTrust } from "../runtime/recovery-writer-durable-trust-bootstrap.js";
import type { AuthenticatedRecoveryWriterPolicySource } from "../runtime/recovery-writer-trust-watermark-contract.js";

const dir = mkdtempSync(join(tmpdir(), "day83-trust-watermark-"));
const path = join(dir, "trust.db");
const deploymentId = "staging-day83";
let now = 1_000_000;
const fingerA = Array(32).fill("AA").join(":");
const fingerB = Array(32).fill("BB").join(":");
const encode = (revision: number, fingerprint256: string = fingerA) => {
  const policy = {
    deploymentId, revision, issuedAtEpochMs: now,
    expiresAtEpochMs: now + 50_000,
    peers: [{ fingerprint256, subject: "svc:claim", grantedOperations: ["claim_outbox"] }]
  };
  const rawPolicyBytes = new TextEncoder().encode(JSON.stringify(policy));
  const policySha256 = createHash("sha256").update(rawPolicyBytes).digest("hex");
  return { watermark: { deploymentId, revision, policySha256 }, rawPolicyBytes };
};
let candidate = encode(1);
let unavailable = false;
const source: AuthenticatedRecoveryWriterPolicySource = {
  getCurrent: async () => unavailable ? null : candidate
};
let a = new SQLiteRecoveryWriterTrustWatermarkStore(path);
let b = new SQLiteRecoveryWriterTrustWatermarkStore(path);
const run = (store = a) => bootstrapRecoveredWriterTrust({
  deploymentId, store, source, nowEpochMs: () => now
});
try {
  // Missing anchor is a hold; no trust-on-first-use.
  assert.equal((await run()).action, "hold");
  assert.equal(a.provisionTrustedAnchor(candidate.watermark), true);
  assert.equal(b.provisionTrustedAnchor(candidate.watermark), false);
  const first = await run();
  assert.equal(first.action, "ready_for_isolated_bootstrap_test");
  if (first.action === "ready_for_isolated_bootstrap_test") {
    assert.equal(first.mode, "exact_restart_replay");
    assert.equal(first.controller.resolve(fingerA)?.subject, "svc:claim");
    assert.equal(first.publishAuthorized, false);
  }

  // Restart a fresh connection and recover exact (revision,digest).
  a.close();
  a = new SQLiteRecoveryWriterTrustWatermarkStore(path);
  assert.equal((await run()).action, "ready_for_isolated_bootstrap_test");

  const expected = (await a.load(deploymentId))!;
  candidate = encode(2, fingerB);
  const advanced = await run(a);
  assert.equal(advanced.action, "ready_for_isolated_bootstrap_test");
  if (advanced.action === "ready_for_isolated_bootstrap_test") {
    assert.equal(advanced.mode, "advance_requires_durable_cas");
    assert.equal(advanced.controller.resolve(fingerA), null);
    assert.equal(advanced.controller.resolve(fingerB)?.subject, "svc:claim");
  }
  assert.equal((await a.load(deploymentId))?.revision, 2);
  // A second connection with an old expected watermark loses the same-SQLite CAS.
  assert.equal(await b.compareAndSwap(expected, encode(3).watermark), "conflict");

  // Restart after durable CAS succeeded but before caller exposed its controller.
  a.close();
  a = new SQLiteRecoveryWriterTrustWatermarkStore(path);
  const restored = await run();
  assert.equal(restored.action, "ready_for_isolated_bootstrap_test");
  if (restored.action === "ready_for_isolated_bootstrap_test") {
    assert.equal(restored.mode, "exact_restart_replay");
  }

  candidate = encode(1); // downgrade (old certificate) blocked
  assert.equal((await run()).action, "hold");
  candidate = encode(2, fingerA); // same revision but different digest
  assert.equal((await run()).action, "hold");
  candidate = encode(3);
  // Unauthenticated or damaged bytes cannot advance watermark.
  const pristine = candidate;
  candidate = { ...pristine, rawPolicyBytes: new Uint8Array([123]) };
  assert.equal((await run()).action, "hold");
  assert.equal((await a.load(deploymentId))?.revision, 2);
  candidate = pristine;
  unavailable = true;
  assert.equal((await run()).action, "hold");
  unavailable = false;
  const previous = (await a.load(deploymentId))!;
  // Simulate crash immediately following durable CAS; exact restart replay is possible.
  assert.equal(await a.compareAndSwap(previous, pristine.watermark), "advanced");
  a.close();
  a = new SQLiteRecoveryWriterTrustWatermarkStore(path);
  assert.equal((await run()).action, "ready_for_isolated_bootstrap_test");

  candidate = encode(4);
  // Invalid expiry must not advance durable revision.
  now += 60_000;
  assert.equal((await run()).action, "hold");
  assert.equal((await a.load(deploymentId))?.revision, 3);
  console.log("PASS Day 83 noon: durable SQLite CAS, restart replay, stale competitor, downgrade, mismatched digest, expiry and source failure");
} finally {
  a.close(); b.close();
  rmSync(dir, { recursive: true, force: true });
}
