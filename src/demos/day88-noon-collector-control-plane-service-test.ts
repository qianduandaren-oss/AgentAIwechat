import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalWriterCollectorClaims, writerCollectorSigningBytes,
  type WriterCollectorClaims
} from "../runtime/recovery-writer-collector-attestation.js";
import {
  SQLiteWriterCollectorChallengeStore
} from "../runtime/recovery-writer-collector-challenge-store.js";
import {
  type CollectorControlPeer,
  type CollectorControlOperation
} from "../runtime/recovery-writer-collector-control-plane-admission.js";
import {
  IsolatedCollectorControlPlaneService,
  type LabCollectorControlRequest
} from "../runtime/recovery-writer-collector-control-plane-service.js";

const dir = mkdtempSync(join(tmpdir(), "day88-control-"));
const dbPath = join(dir, "release.sqlite");
let store = new SQLiteWriterCollectorChallengeStore(dbPath);
const otherConnection = new SQLiteWriterCollectorChallengeStore(dbPath);
const now = Date.UTC(2026, 10, 17, 4, 0, 0);
const dep = "staging:day88", release = "release-day88";
let peer: CollectorControlPeer | null = null;
const admin: CollectorControlPeer = {
  principalId: "admin-1", role: "release_admin", deploymentId: dep,
  releaseId: release, allowedOperations: ["provision_collector_key", "revoke_collector_key"]
};
const issuer: CollectorControlPeer = {
  principalId: "issuer-1", role: "challenge_issuer", deploymentId: dep,
  releaseId: release, allowedOperations: ["issue_challenge"]
};
const svc = new IsolatedCollectorControlPlaneService(store, {
  deploymentId: dep, releaseId: release,
  authenticatedPeer: () => peer, nowEpochMs: () => now
});
const keyPair = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
let seq = 0;
function request(op: CollectorControlOperation, extra: Partial<LabCollectorControlRequest> = {})
  : LabCollectorControlRequest {
  const data: LabCollectorControlRequest = {
    requestId: "request-" + (++seq), intent: "isolated_review",
    command: {
      operation: op, deploymentId: dep, releaseId: release, keyId: "collector-A"
    },
    payload: op === "provision_collector_key" ? { publicKeyPem: keyPair.publicKey } :
      op === "issue_challenge" ? {
        observerId: "probe-1", hostId: "lab-host",
        mountNamespaceId: "mnt:[4026531800]", ttlMs: 60_000
      } : {}
  };
  return { ...data, ...extra };
}
function denied(result: { action: string; reason?: string; publishAuthorized: boolean }, reason: string): void {
  assert.equal(result.action, "hold");
  assert.equal(result.reason, reason);
  assert.equal(result.publishAuthorized, false);
}
try {
  // Request bodies never select peer role/permissions; resolver is held by ingress.
  peer = null;
  denied(svc.execute(request("issue_challenge")), "authenticated_peer_missing");
  peer = { ...issuer, role: "runtime_worker" };
  denied(svc.execute(request("issue_challenge")), "role_forbidden");
  peer = { ...issuer, allowedOperations: [] };
  denied(svc.execute(request("issue_challenge")), "operation_not_granted");
  peer = issuer;
  denied(svc.execute(request("issue_challenge", {
    command: { operation: "issue_challenge", deploymentId: dep,
      releaseId: "wrong-release", keyId: "collector-A" }
  })), "release_scope_mismatch");
  denied(svc.execute(request("issue_challenge", {
    command: { operation: "issue_challenge", deploymentId: dep,
      releaseId: release, keyId: "collector-A", claimedPrincipalId: "admin-1" }
  })), "principal_claim_mismatch");
  denied(svc.execute(request("issue_challenge", {
    intent: "production_release"
  })), "production_control_not_authorized");

  // Executing an authorized command still requires a pre-provisioned key.
  denied(svc.execute(request("issue_challenge")), "collector_key_not_active");
  peer = admin;
  const provision = request("provision_collector_key");
  const p = svc.execute(provision);
  assert.equal(p.action, "ready_for_isolated_control_execution");
  assert.equal(p.publishAuthorized, false);
  const again = svc.execute(provision);
  assert.equal(again.action, "ready_for_isolated_control_execution");
  if (again.action !== "hold") assert.equal(again.reason, "idempotent_replay");
  denied(svc.execute({ ...provision, payload: { publicKeyPem: "different" } }),
    "control_request_id_conflict");

  peer = issuer;
  const issue = request("issue_challenge");
  const issued = svc.execute(issue);
  assert.equal(issued.action, "ready_for_isolated_control_execution");
  assert.equal(issued.publishAuthorized, false);
  assert.ok(issued.action !== "hold" && issued.challengeId);
  if (issued.action === "hold" || !issued.challengeId) throw Error("missing_challenge_id");
  const challengeId = issued.challengeId;
  const retry = svc.execute(issue);
  assert.equal(retry.action, "ready_for_isolated_control_execution");
  if (retry.action !== "hold") {
    assert.equal(retry.reason, "idempotent_replay");
    assert.equal(retry.challengeId, challengeId);
  }
  denied(svc.execute({ ...issue, payload: { ...issue.payload, ttlMs: 20_000 } }),
    "control_request_id_conflict");

  // The original Day 87 consume path must still accept exactly one signed artifact.
  const rawArtifactBytes = new TextEncoder().encode("day88-isolated-fd-fixture");
  const claims: WriterCollectorClaims = {
    schemaVersion: 1, deploymentId: dep, releaseId: release,
    observerId: "probe-1", hostId: "lab-host",
    mountNamespaceId: "mnt:[4026531800]", challengeId,
    observedAtEpochMs: now + 1000,
    artifactSha256: createHash("sha256").update(rawArtifactBytes).digest("hex")
  };
  const payloadBytes = canonicalWriterCollectorClaims(claims);
  const signatureHex = Array.from(sign(
    null, writerCollectorSigningBytes(payloadBytes), keyPair.privateKey
  )).map(b => b.toString(16).padStart(2, "0")).join("");
  const artifact = { keyId: "collector-A", payloadBytes, signatureHex, rawArtifactBytes };
  const consume = () => otherConnection.verifyAndConsume({
    intent: "isolated_review", deploymentId: dep, releaseId: release,
    observerId: "probe-1", hostId: "lab-host", mountNamespaceId: "mnt:[4026531800]",
    nowEpochMs: now + 2000, artifact
  });
  assert.equal(consume().action, "ready_for_isolated_single_use_review");
  denied(consume(), "challenge_replayed");

  peer = admin;
  const revoked = svc.execute(request("revoke_collector_key"));
  assert.equal(revoked.action, "ready_for_isolated_control_execution");
  peer = issuer;
  denied(svc.execute(request("issue_challenge")), "collector_key_not_active");

  // Audit is persisted and records both authorizations and denials.
  const history = store.listControlAuditForLab(dep, release);
  assert.ok(history.some(x => x.decision === "deny" &&
    x.reason === "authenticated_peer_missing"));
  assert.ok(history.some(x => x.decision === "deny" &&
    x.reason === "role_forbidden"));
  assert.ok(history.some(x => x.decision === "executed" &&
    x.operation === "issue_challenge" && x.challenge_id === challengeId));
  const countBefore = history.length;
  store.close();
  store = new SQLiteWriterCollectorChallengeStore(dbPath);
  assert.equal(store.listControlAuditForLab(dep, release).length, countBefore,
    "audit must survive restart");

  // Explicitly break the durable audit destination. No mutation may commit.
  const brokenAudit = new DatabaseSync(dbPath);
  brokenAudit.exec("DROP TABLE recovery_writer_collector_control_audit");
  brokenAudit.close();
  peer = admin;
  const brokenService = new IsolatedCollectorControlPlaneService(store, {
    deploymentId: dep, releaseId: release,
    authenticatedPeer: () => peer, nowEpochMs: () => now
  });
  denied(brokenService.execute(request("provision_collector_key", {
    command: { operation: "provision_collector_key", deploymentId: dep,
      releaseId: release, keyId: "collector-C" }
  })), "control_audit_transaction_unavailable");
  // If write rolled back, the old lab-only method can provision C anew.
  assert.equal(otherConnection.provisionLabTrustedKey(dep, "collector-C",
    keyPair.publicKey), true);

  console.log("PASS Day 88 noon: ingress-owned peer, durable deny/execute audit, " +
    "atomic admin mutation, retry idempotency, restart, revoked key and rollback.");
  console.log("LIMIT: lab identity resolver and legacy direct store methods remain; " +
    "no real mTLS, OS DB/WAL isolation or production release, NO_GO.");
} finally {
  try { store.close(); } catch { /* fault-safe cleanup */ }
  try { otherConnection.close(); } catch { /* fault-safe cleanup */ }
  rmSync(dir, { recursive: true, force: true });
}
