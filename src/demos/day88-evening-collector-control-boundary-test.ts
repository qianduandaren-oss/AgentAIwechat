import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  captureControlAuditSnapshotForLab, reviewControlAuditSnapshotForLab
} from "../runtime/recovery-writer-collector-control-audit-review.js";
import {
  SQLiteWriterCollectorChallengeStore
} from "../runtime/recovery-writer-collector-challenge-store.js";
import {
  type CollectorControlPeer, type CollectorControlOperation
} from "../runtime/recovery-writer-collector-control-plane-admission.js";
import {
  IsolatedCollectorControlPlaneService,
  type LabCollectorControlRequest
} from "../runtime/recovery-writer-collector-control-plane-service.js";
import {
  canonicalWriterCollectorClaims, writerCollectorSigningBytes,
  type WriterCollectorClaims
} from "../runtime/recovery-writer-collector-attestation.js";

const dir = mkdtempSync(join(tmpdir(), "day88-evening-"));
const dep = "staging:day88-evening";
const release = "release-88";
const now = Date.UTC(2026, 10, 17, 10, 0);
const keys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const admin: CollectorControlPeer = {
  principalId: "admin", role: "release_admin", deploymentId: dep,
  releaseId: release, allowedOperations: [
    "provision_collector_key", "revoke_collector_key"
  ]
};
const issuer: CollectorControlPeer = {
  principalId: "issuer", role: "challenge_issuer", deploymentId: dep,
  releaseId: release, allowedOperations: ["issue_challenge"]
};
const worker: CollectorControlPeer = {
  principalId: "worker", role: "runtime_worker", deploymentId: dep,
  releaseId: release, allowedOperations: []
};
let seq = 0;
function command(op: CollectorControlOperation, keyId: string): LabCollectorControlRequest {
  return {
    requestId: "evening-" + (++seq), intent: "isolated_review",
    command: { operation: op, deploymentId: dep, releaseId: release, keyId },
    payload: op === "provision_collector_key"
      ? { publicKeyPem: keys.publicKey }
      : op === "issue_challenge"
        ? { observerId: "probe", hostId: "host", mountNamespaceId: "mnt:[1]", ttlMs: 60000 }
        : {}
  };
}
const hold = (x: { action: string; reason?: string; publishAuthorized: boolean }, reason: string) => {
  assert.equal(x.action, "hold");
  assert.equal(x.reason, reason);
  assert.equal(x.publishAuthorized, false);
};

function setup(name: string) {
  const dbPath = join(dir, name + ".sqlite");
  const store = new SQLiteWriterCollectorChallengeStore(dbPath);
  const other = new SQLiteWriterCollectorChallengeStore(dbPath);
  let peer: CollectorControlPeer | null = admin;
  const service = new IsolatedCollectorControlPlaneService(store, {
    deploymentId: dep, releaseId: release,
    authenticatedPeer: () => peer, nowEpochMs: () => now
  });
  return {
    dbPath, store, other, service,
    setPeer: (p: CollectorControlPeer | null) => { peer = p; },
    close: () => { store.close(); other.close(); }
  };
}
function success(x: { action: string; publishAuthorized: boolean; challengeId?: string }) {
  assert.equal(x.action, "ready_for_isolated_control_execution");
  assert.equal(x.publishAuthorized, false);
  return x.challengeId;
}
function signedArtifact(challengeId: string) {
  const rawArtifactBytes = new TextEncoder().encode("day88-evening-fixture");
  const claims: WriterCollectorClaims = {
    schemaVersion: 1, deploymentId: dep, releaseId: release,
    observerId: "probe", hostId: "host", mountNamespaceId: "mnt:[1]",
    challengeId, observedAtEpochMs: now + 1000,
    artifactSha256: createHash("sha256").update(rawArtifactBytes).digest("hex")
  };
  const payloadBytes = canonicalWriterCollectorClaims(claims);
  const signatureHex = Array.from(sign(
    null, writerCollectorSigningBytes(payloadBytes), keys.privateKey
  )).map(b => b.toString(16).padStart(2, "0")).join("");
  return { keyId: "collector-A", payloadBytes, signatureHex, rawArtifactBytes };
}

try {
  // 1. A local digest kept outside SQLite detects a later direct SQL audit edit.
  const a = setup("audit");
  try {
    success(a.service.execute(command("provision_collector_key", "collector-A")));
    a.setPeer(issuer);
    const id = success(a.service.execute(command("issue_challenge", "collector-A")));
    assert.ok(id);
    const snapshot = captureControlAuditSnapshotForLab({
      dbPath: a.dbPath, deploymentId: dep, releaseId: release
    });
    assert.equal(snapshot.action, "lab_snapshot");
    if (snapshot.action === "hold") throw Error(snapshot.reason);
    hold(reviewControlAuditSnapshotForLab({
      dbPath: a.dbPath, deploymentId: dep, releaseId: release,
      externallyPinnedSha256: null
    }), "external_audit_anchor_missing");
    const ok = reviewControlAuditSnapshotForLab({
      dbPath: a.dbPath, deploymentId: dep, releaseId: release,
      externallyPinnedSha256: snapshot.sha256
    });
    assert.equal(ok.action, "ready_for_isolated_audit_rehearsal");
    assert.equal(ok.publishAuthorized, false);

    const raw = new DatabaseSync(a.dbPath);
    raw.prepare("UPDATE recovery_writer_collector_control_audit SET principal_id=? " +
      "WHERE request_id=?").run("forged-admin", "evening-1");
    raw.close();
    hold(reviewControlAuditSnapshotForLab({
      dbPath: a.dbPath, deploymentId: dep, releaseId: release,
      externallyPinnedSha256: snapshot.sha256
    }), "external_audit_anchor_mismatch");
  } finally { a.close(); }

  // 2. Old store API bypasses the service and durable audit; a real risk.
  const b = setup("bypass");
  try {
    success(b.service.execute(command("provision_collector_key", "collector-A")));
    b.setPeer(worker);
    hold(b.service.execute(command("issue_challenge", "collector-A")), "role_forbidden");
    // Bypass is EXPECTED to succeed! CI passing is proof of a still-open risk.
    const legacyChallengeId = b.other.issueChallenge({
      deploymentId: dep, releaseId: release, keyId: "collector-A",
      observerId: "probe", hostId: "host", mountNamespaceId: "mnt:[1]",
      nowEpochMs: now, ttlMs: 60000
    });
    assert.ok(legacyChallengeId);
    hold(captureControlAuditSnapshotForLab({
      dbPath: b.dbPath, deploymentId: dep, releaseId: release
    }), "unaudited_challenge:" + legacyChallengeId);
    assert.equal(b.store.provisionLabTrustedKey(dep, "legacy-unlogged-key",
      keys.publicKey), true);
    hold(captureControlAuditSnapshotForLab({
      dbPath: b.dbPath, deploymentId: dep, releaseId: release
    }), "unaudited_key:legacy-unlogged-key");
  } finally { b.close(); }

  // 3. Revocation and signed-consume serialize through one SQLite writer lock.
  // Test both deterministic interleavings; this is NOT an OS-level race harness.
  const c = setup("revocation");
  try {
    success(c.service.execute(command("provision_collector_key", "collector-A")));
    c.setPeer(issuer);
    const before = success(c.service.execute(command("issue_challenge", "collector-A")));
    assert.ok(before);
    c.setPeer(admin);
    success(c.service.execute(command("revoke_collector_key", "collector-A")));
    const consume = (id: string) => c.other.verifyAndConsume({
      intent: "isolated_review", deploymentId: dep, releaseId: release,
      observerId: "probe", hostId: "host", mountNamespaceId: "mnt:[1]",
      nowEpochMs: now + 2000, artifact: signedArtifact(id)
    });
    hold(consume(before!), "collector_key_revoked");

    // A different key ID with the same test key material is only a lab stand-in
    // for the opposite transaction ordering, NOT a production key rotation.
    success(c.service.execute(command("provision_collector_key", "collector-B")));
    c.setPeer(issuer);
    const after = success(c.service.execute(command("issue_challenge", "collector-B")));
    assert.ok(after);
    const signedB = { ...signedArtifact(after!), keyId: "collector-B" };
    const consumeB = () => c.other.verifyAndConsume({
      intent: "isolated_review", deploymentId: dep, releaseId: release,
      observerId: "probe", hostId: "host", mountNamespaceId: "mnt:[1]",
      nowEpochMs: now + 2000, artifact: signedB
    });
    assert.equal(consumeB().action, "ready_for_isolated_single_use_review");
    c.setPeer(admin);
    success(c.service.execute(command("revoke_collector_key", "collector-B")));
    hold(consumeB(), "challenge_replayed");
    const expected = captureControlAuditSnapshotForLab({
      dbPath: c.dbPath, deploymentId: dep, releaseId: release
    });
    assert.equal(expected.action, "lab_snapshot");
  } finally { c.close(); }

  console.log("PASS Day 88 evening: trusted snapshot detects direct audit SQL tamper; " +
    "legacy direct key/challenge calls are proven bypasses; revoke-before-consume HOLD; " +
    "consume-before-revoke single use.");
  console.log("NO_GO: snapshot anchor is local test memory, legacy methods remain public, " +
    "DB files are writable by legacy peers and no production mTLS/OS evidence exists.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
