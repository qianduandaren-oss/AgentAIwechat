/**
 * Day 88 evening: advisory SQLite audit reconciliation and externally anchored
 * snapshot check. Only for a disposable lab database.
 *
 * Important: the caller supplies the "external" expected digest. This module
 * cannot authenticate the caller, protect the anchor or exclude legacy direct SQL.
 * It NEVER approves production release.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const SHA = /^[0-9a-f]{64}$/;

type AuditRow = {
  id: number; deployment_id: string; release_id: string;
  request_id: string; principal_id: string; operation: string;
  key_id: string; request_sha256: string; decision: string;
  reason: string; challenge_id: string | null; at_epoch_ms: number;
};
type KeyRow = { key_id: string; revoked: number };
type ChallengeRow = { challenge_id: string; key_id: string };

export interface ControlAuditSnapshotInput {
  readonly dbPath: string;
  readonly deploymentId: string;
  readonly releaseId: string;
}
export type ControlAuditSnapshot =
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>
  | Readonly<{ action: "lab_snapshot"; sha256: string;
      auditRows: number; keys: number; challenges: number;
      publishAuthorized: false }>;
export type ControlAuditReview =
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>
  | Readonly<{ action: "ready_for_isolated_audit_rehearsal";
      auditSha256: string; publishAuthorized: false }>;

const hold = (reason: string) => ({
  action: "hold" as const, reason, publishAuthorized: false as const
});
const valid = (s: unknown): s is string =>
  typeof s === "string" && ID.test(s);

/** Readonly by convention, NOT by kernel/SQLite enforcement. */
function collect(input: ControlAuditSnapshotInput):
  { audit: AuditRow[]; keys: KeyRow[]; challenges: ChallengeRow[] } {
  const db = new DatabaseSync(input.dbPath);
  try {
    const audit = db.prepare(
      "SELECT id,deployment_id,release_id,request_id,principal_id," +
      "operation,key_id,request_sha256,decision,reason,challenge_id,at_epoch_ms " +
      "FROM recovery_writer_collector_control_audit " +
      "WHERE deployment_id=? AND release_id=? ORDER BY id"
    ).all(input.deploymentId, input.releaseId) as unknown as AuditRow[];
    const keys = db.prepare(
      "SELECT key_id,revoked FROM recovery_writer_collector_keys " +
      "WHERE deployment_id=? ORDER BY key_id"
    ).all(input.deploymentId) as unknown as KeyRow[];
    const challenges = db.prepare(
      "SELECT challenge_id,key_id FROM recovery_writer_collector_challenges " +
      "WHERE deployment_id=? AND release_id=? ORDER BY challenge_id"
    ).all(input.deploymentId, input.releaseId) as unknown as ChallengeRow[];
    return { audit, keys, challenges };
  } finally {
    db.close();
  }
}

/**
 * Snapshot digest covers the *selected release* audit rows, deployment-wide
 * key states and release challenges. A test can keep this digest outside SQLite.
 * This is not a signed or trusted production audit anchor.
 */
export function captureControlAuditSnapshotForLab(
  input: ControlAuditSnapshotInput
): ControlAuditSnapshot {
  if (!input || !valid(input.dbPath) && (
    typeof input.dbPath !== "string" || !input.dbPath.trim()
  ) || !valid(input.deploymentId) || !valid(input.releaseId)) {
    return hold("audit_snapshot_input_invalid");
  }
  try {
    const { audit, keys, challenges } = collect(input);
    if (audit.length === 0) return hold("audit_empty");
    // Reconcile only same-release keys: cross-release provisioning is deliberately
    // NOT asserted as complete by this lab-only checker.
    for (const key of keys) {
      const provision = audit.some(x => x.key_id === key.key_id &&
        x.operation === "provision_collector_key" && x.decision === "executed");
      if (!provision) return hold("unaudited_key:" + key.key_id);
      if (key.revoked !== 0 && !audit.some(x => x.key_id === key.key_id &&
        x.operation === "revoke_collector_key" && x.decision === "executed")) {
        return hold("unaudited_revocation:" + key.key_id);
      }
    }
    for (const challenge of challenges) {
      if (!audit.some(x => x.challenge_id === challenge.challenge_id &&
          x.key_id === challenge.key_id &&
          x.operation === "issue_challenge" && x.decision === "executed")) {
        return hold("unaudited_challenge:" + challenge.challenge_id);
      }
    }
    const bytes = new TextEncoder().encode(
      "AGENTAIWECHAT/DAY88/CONTROL-AUDIT-SNAPSHOT/V1\n" +
      JSON.stringify({ deploymentId: input.deploymentId,
        releaseId: input.releaseId, audit, keys, challenges })
    );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { action: "lab_snapshot", sha256, auditRows: audit.length,
      keys: keys.length, challenges: challenges.length,
      publishAuthorized: false };
  } catch {
    return hold("audit_snapshot_unavailable");
  }
}

/**
 * Validate a previously captured expected snapshot digest. The anchor must be
 * pinned OUTSIDE the database by an independently trusted component in production.
 */
export function reviewControlAuditSnapshotForLab(
  input: ControlAuditSnapshotInput & { readonly externallyPinnedSha256: string | null }
): ControlAuditReview {
  if (!SHA.test(input?.externallyPinnedSha256 ?? "")) {
    return hold("external_audit_anchor_missing");
  }
  const snapshot = captureControlAuditSnapshotForLab(input);
  if (snapshot.action === "hold") return snapshot;
  if (snapshot.sha256 !== input.externallyPinnedSha256) {
    return hold("external_audit_anchor_mismatch");
  }
  return { action: "ready_for_isolated_audit_rehearsal",
    auditSha256: snapshot.sha256, publishAuthorized: false };
}
