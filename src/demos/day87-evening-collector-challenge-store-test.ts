import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalWriterCollectorClaims,
  writerCollectorSigningBytes,
  type SignedWriterCollectorArtifact,
  type WriterCollectorClaims
} from "../runtime/recovery-writer-collector-attestation.js";
import {
  SQLiteWriterCollectorChallengeStore,
  type CollectorChallengeTarget
} from "../runtime/recovery-writer-collector-challenge-store.js";

const now = Date.UTC(2026, 10, 16, 10, 0, 0);
const target: CollectorChallengeTarget = {
  deploymentId: "staging:day87", releaseId: "release-day87",
  observerId: "isolated-probe", hostId: "lab-host",
  mountNamespaceId: "mnt:[4026531800]"
};
const keyA = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const keyB = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
const dir = mkdtempSync(join(tmpdir(), "day87-challenge-"));
const path = join(dir, "release.sqlite");
let a = new SQLiteWriterCollectorChallengeStore(path);
const b = new SQLiteWriterCollectorChallengeStore(path);
function issue(keyId: string, issuedAt = now, ttlMs = 60_000): string {
  return a.issueChallenge({ ...target, keyId, nowEpochMs: issuedAt, ttlMs });
}
function artifact(challengeId: string, keyId: string, privateKey: string,
  observedAtEpochMs = now + 1000): SignedWriterCollectorArtifact {
  const rawArtifactBytes = new TextEncoder().encode(
    "lab-only:/proc/fixture/fdinfo=O_RDWR;challenge=" + challengeId);
  const claims: WriterCollectorClaims = {
    schemaVersion: 1, ...target, challengeId, observedAtEpochMs,
    artifactSha256: createHash("sha256").update(rawArtifactBytes).digest("hex")
  };
  const payloadBytes = canonicalWriterCollectorClaims(claims);
  return {
    keyId, payloadBytes,
    signatureHex: toHex(sign(null, writerCollectorSigningBytes(payloadBytes), privateKey)),
    rawArtifactBytes
  };
}
const use = (store: SQLiteWriterCollectorChallengeStore,
  evidence: SignedWriterCollectorArtifact, at = now + 2000) =>
  store.verifyAndConsume({
    intent: "isolated_review", ...target, nowEpochMs: at, artifact: evidence
  });
const denied = (reason: string) => ({
  action: "hold", reason, publishAuthorized: false
});

try {
  // The trust root is explicitly pre-provisioned by the test control plane.
  assert.equal(a.provisionLabTrustedKey(target.deploymentId, "collector-A", keyA.publicKey), true);
  assert.equal(b.provisionLabTrustedKey(target.deploymentId, "collector-A", keyA.publicKey), false);
  assert.equal(a.provisionLabTrustedKey(target.deploymentId, "collector-A", keyB.publicKey), false,
    "a keyId cannot silently swap public keys");
  let refusedIssue = false;
  try { issue("missing-key"); } catch { refusedIssue = true; }
  assert.equal(refusedIssue, true);
  refusedIssue = false;
  try { issue("collector-A", now, 0); } catch { refusedIssue = true; }
  assert.equal(refusedIssue, true);

  const idA = issue("collector-A");
  assert.equal(idA.length, 48);
  const good = artifact(idA, "collector-A", keyA.privateKey);
  const badBytes = { ...good, rawArtifactBytes: new TextEncoder().encode("tampered") };
  assert.deepEqual(use(a, badBytes), denied("signature:raw_artifact_digest_mismatch"));
  assert.equal(a.getChallengeState(target.deploymentId, target.releaseId, idA), "issued",
    "failed verification cannot consume a challenge");
  const badSignature = artifact(idA, "collector-A", keyB.privateKey);
  assert.deepEqual(use(a, badSignature), denied("signature:collector_signature_invalid"));
  assert.deepEqual(a.verifyAndConsume({
    intent: "isolated_review", ...target, hostId: "wrong-host",
    nowEpochMs: now + 2000, artifact: good
  }), denied("challenge_target_mismatch"));
  assert.equal(a.getChallengeState(target.deploymentId, target.releaseId, idA), "issued");

  const consumed = use(a, good);
  assert.equal(consumed.action, "ready_for_isolated_single_use_review");
  assert.equal(consumed.publishAuthorized, false);
  assert.equal(a.getChallengeState(target.deploymentId, target.releaseId, idA), "consumed");
  assert.deepEqual(use(b, good), denied("challenge_replayed"),
    "another connection cannot reuse an accepted signature");

  // Crash/restart: consumed state survives reconnecting the DB.
  a.close();
  a = new SQLiteWriterCollectorChallengeStore(path);
  assert.deepEqual(use(a, good), denied("challenge_replayed"));

  const racedId = issue("collector-A");
  const raced = artifact(racedId, "collector-A", keyA.privateKey);
  const outcomes = [use(a, raced).action, use(b, raced).action];
  assert.deepEqual(outcomes, ["ready_for_isolated_single_use_review", "hold"]);

  const staleId = issue("collector-A");
  assert.deepEqual(use(a, artifact(staleId, "collector-A", keyA.privateKey),
    now + 60_001), denied("challenge_expired_or_clock_invalid"));
  assert.equal(a.getChallengeState(target.deploymentId, target.releaseId, staleId), "issued");

  const oldId = issue("collector-A");
  const signedBeforeRevocation = artifact(oldId, "collector-A", keyA.privateKey);
  // Under the SAME SQLite writer lock, key revocation wins over later consume.
  assert.equal(b.revokeTrustedKey(target.deploymentId, "collector-A"), true);
  assert.equal(b.revokeTrustedKey(target.deploymentId, "collector-A"), false);
  assert.deepEqual(use(a, signedBeforeRevocation), denied("collector_key_revoked"));
  assert.equal(a.getChallengeState(target.deploymentId, target.releaseId, oldId), "issued");
  refusedIssue = false;
  try { issue("collector-A"); } catch { refusedIssue = true; }
  assert.equal(refusedIssue, true);

  // Key rotation: B is independently pinned; A remains revoked.
  assert.equal(a.provisionLabTrustedKey(target.deploymentId, "collector-B", keyB.publicKey), true);
  const freshId = issue("collector-B");
  const fresh = artifact(freshId, "collector-B", keyB.privateKey);
  assert.deepEqual(a.verifyAndConsume({
    intent: "production_release", ...target, nowEpochMs: now + 2000, artifact: fresh
  }), denied("production_release_not_authorized"));
  assert.equal(a.getChallengeState(target.deploymentId, target.releaseId, freshId), "issued");
  assert.equal(use(b, fresh).action, "ready_for_isolated_single_use_review");
  assert.equal(use(a, fresh).action, "hold");

  const revokedBId = issue("collector-B");
  const signedB = artifact(revokedBId, "collector-B", keyB.privateKey);
  assert.equal(a.revokeTrustedKey(target.deploymentId, "collector-B"), true);
  assert.deepEqual(use(b, signedB), denied("collector_key_revoked"));
  assert.equal(a.getChallengeState(target.deploymentId, target.releaseId, revokedBId), "issued");
  assert.deepEqual(use(a, { ...good, keyId: "collector-B" }),
    denied("challenge_replayed"), "consumed challenge is not revived by relabeling");
  assert.deepEqual(use(a, artifact("deadbeef", "collector-A", keyA.privateKey)),
    denied("challenge_not_issued"));

  console.log("PASS Day 87 evening: SQLite single-use challenge, restart, replay, " +
    "invalid signature, target binding, expiry, key rotation and revocation.");
  console.log("LIMIT: local fixture / pre-provisioned keys; no real collector identity, " +
    "production OS audit or Consumer ACK. publishAuthorized=false, NO_GO.");
} finally {
  try { a.close(); } catch { /* fault-injection-safe close */ }
  b.close();
  rmSync(dir, { recursive: true, force: true });
}
