/**
 * Day 96 noon: single SQLite transaction-domain lab, never production auth.
 * No network, real credentials, real release effects or Day 95 bypass.
 * The controller seeds synthetic state; principals and clock are lab fixtures.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { Day91InventoryBinding } from "./recovery-writer-cutover-inventory-adapter.js";

export interface Day96LabScope extends Day91InventoryBinding {
  readonly resourceId: string;
}
export interface Day96LabPolicy extends Day96LabScope {
  readonly policyEpoch: number;
  readonly policySha256: string;
  readonly keySpkiSha256: string;
  readonly keyActive: boolean;
  readonly notBeforeEpochMs: number;
  readonly policyExpiresAtEpochMs: number;
  readonly checkpointSequence: number;
  readonly eventSha256: string;
  readonly evidenceSha256: string;
  readonly evidenceExpiresAtEpochMs: number;
}
export interface Day96IssueRequest {
  readonly intent: "isolated_lab" | "production_release";
  readonly expected: Day96LabPolicy;
  readonly requestId: string;
  readonly principal: string;
  readonly operation: "dummy_write";
  readonly commandSha256: string;
  readonly expiresAtEpochMs: number;
}
export interface Day96ConsumeRequest extends Day96LabScope {
  readonly intent: "isolated_lab" | "production_release";
  readonly requestId: string;
  readonly principal: string;
  readonly operation: "dummy_write";
  readonly command: string;
  readonly fence: number;
}
export interface Day96LabReceipt {
  readonly resourceId: string;
  readonly requestId: string;
  readonly fence: number;
  readonly commandSha256: string;
  readonly committedAtEpochMs: number;
}
type Result = { readonly status: string; readonly fence?: number;
  readonly receipt?: Day96LabReceipt; readonly publishAuthorized: false };
type StateRow = { policy_json: string; floor: number };
type CapabilityRow = { request_json: string; fence: number; receipt_json: string | null };

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;
const id = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const sha = (v: unknown): v is string => typeof v === "string" && SHA.test(v);
const nat = (v: number) => Number.isSafeInteger(v) && v >= 0;
const pos = (v: number) => nat(v) && v > 0;
export const day96LabSha256 = (s: string) =>
  createHash("sha256").update(new TextEncoder().encode(s)).digest("hex");
const scopeValid = (p: Day96LabScope) => !!p &&
  [p.deploymentId,p.releaseId,p.attemptId,p.resourceId].every(id);
const scopeEqual = (a: Day96LabScope,b: Day96LabScope) =>
  a.deploymentId === b.deploymentId && a.releaseId === b.releaseId &&
  a.attemptId === b.attemptId && a.resourceId === b.resourceId;
function canonical(p: Day96LabPolicy): Day96LabPolicy {
  return { deploymentId:p.deploymentId, releaseId:p.releaseId, attemptId:p.attemptId,
    resourceId:p.resourceId, policyEpoch:p.policyEpoch, policySha256:p.policySha256,
    keySpkiSha256:p.keySpkiSha256, keyActive:p.keyActive, notBeforeEpochMs:p.notBeforeEpochMs,
    policyExpiresAtEpochMs:p.policyExpiresAtEpochMs, checkpointSequence:p.checkpointSequence,
    eventSha256:p.eventSha256, evidenceSha256:p.evidenceSha256,
    evidenceExpiresAtEpochMs:p.evidenceExpiresAtEpochMs };
}
const policyValid = (p: Day96LabPolicy) => scopeValid(p) && pos(p.policyEpoch) &&
  pos(p.checkpointSequence) && typeof p.keyActive === "boolean" &&
  [p.policySha256,p.keySpkiSha256,p.eventSha256,p.evidenceSha256].every(sha) &&
  [p.notBeforeEpochMs,p.policyExpiresAtEpochMs,p.evidenceExpiresAtEpochMs].every(nat) &&
  p.notBeforeEpochMs < Math.min(p.policyExpiresAtEpochMs,p.evidenceExpiresAtEpochMs);
const identity = (p: Day96LabPolicy) => JSON.stringify(canonical(p));
const eligible = (p: Day96LabPolicy, now: number) => p.keyActive &&
  now >= p.notBeforeEpochMs && now < Math.min(p.policyExpiresAtEpochMs,p.evidenceExpiresAtEpochMs);
const next = (n: number) => {
  if (!nat(n) || n >= Number.MAX_SAFE_INTEGER) throw Error("lab_counter_exhausted");
  return n + 1;
};
function outcome(status: string, extra: Omit<Result,"status"|"publishAuthorized"> = {}): Result {
  return { status, ...extra, publishAuthorized:false };
}
function issueJson(q: Day96IssueRequest): string {
  return JSON.stringify({ intent:q.intent, expected:canonical(q.expected),
    requestId:q.requestId, principal:q.principal, operation:q.operation,
    commandSha256:q.commandSha256, expiresAtEpochMs:q.expiresAtEpochMs });
}

/** All tables are synthetic lab data. No production entry point. */
export class SQLiteDay96AtomicAuthorizationLab {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly clock: () => number) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=250;
      CREATE TABLE IF NOT EXISTS day96_lab_state(
        resource_id TEXT PRIMARY KEY, policy_json TEXT NOT NULL,
        floor INTEGER NOT NULL CHECK(floor >= 0));
      CREATE TABLE IF NOT EXISTS day96_lab_capability(
        resource_id TEXT NOT NULL, request_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
        request_json TEXT NOT NULL, fence INTEGER NOT NULL CHECK(fence > 0),
        receipt_json TEXT, PRIMARY KEY(resource_id,request_id),
        UNIQUE(resource_id,attempt_id));
      CREATE TABLE IF NOT EXISTS day96_lab_effect(
        resource_id TEXT NOT NULL, request_id TEXT NOT NULL, command TEXT NOT NULL,
        PRIMARY KEY(resource_id,request_id));`);
  }
  close(): void { this.db.close(); }
  private tx<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      throw e;
    }
  }
  private now(): number {
    const n = this.clock();
    if (!nat(n)) throw Error("lab_clock_invalid");
    return n;
  }
  private state(resourceId: string) {
    const row = this.db.prepare("SELECT policy_json,floor FROM day96_lab_state WHERE resource_id=?")
      .get(resourceId) as StateRow | undefined;
    if (!row) return null;
    const p = JSON.parse(row.policy_json) as Day96LabPolicy;
    if (!policyValid(p) || p.resourceId !== resourceId || !nat(row.floor) ||
        identity(p) !== row.policy_json) throw Error("lab_state_invalid");
    return { policy:p, floor:row.floor };
  }
  private cap(resourceId: string, requestId: string) {
    return this.db.prepare("SELECT request_json,fence,receipt_json FROM day96_lab_capability WHERE resource_id=? AND request_id=?")
      .get(resourceId,requestId) as CapabilityRow | undefined;
  }
  /** Lab controller only; does not overwrite or resurrect existing state. */
  initialize(p: Day96LabPolicy): Result {
    if (!policyValid(p)) return outcome("invalid_policy");
    return this.tx(() => {
      const current = this.state(p.resourceId);
      if (current) return outcome(identity(p) === identity(current.policy) ? "already_initialized" : "state_exists");
      this.db.prepare("INSERT INTO day96_lab_state VALUES(?,?,0)").run(p.resourceId,identity(p));
      return outcome("initialized");
    });
  }
  /** Atomic conditionally issue a single dummy capability for this attempt. */
  issue(q: Day96IssueRequest): Result {
    if (q?.intent !== "isolated_lab") return outcome("production_release_not_authorized");
    if (!policyValid(q.expected) || !id(q.requestId) || !id(q.principal) ||
        q.operation !== "dummy_write" || !sha(q.commandSha256) || !nat(q.expiresAtEpochMs))
      return outcome("invalid_issue_request");
    return this.tx(() => {
      const s = this.state(q.expected.resourceId);
      const now = this.now();
      if (!s || identity(s.policy) !== identity(q.expected)) return outcome("policy_cas_conflict");
      if (!eligible(s.policy,now)) return outcome("policy_not_eligible");
      if (q.expiresAtEpochMs <= now ||
          q.expiresAtEpochMs > Math.min(s.policy.policyExpiresAtEpochMs,s.policy.evidenceExpiresAtEpochMs))
        return outcome("capability_window_invalid");
      const prior = this.cap(s.policy.resourceId,q.requestId);
      if (prior) {
        if (prior.request_json !== issueJson(q)) return outcome("request_conflict");
        if (prior.fence !== s.floor || prior.receipt_json !== null) return outcome("capability_not_reissuable");
        return outcome("exact_issue_replay",{fence:prior.fence});
      }
      const usedAttempt = this.db.prepare("SELECT request_id FROM day96_lab_capability WHERE resource_id=? AND attempt_id=?")
        .get(s.policy.resourceId,s.policy.attemptId);
      if (usedAttempt) return outcome("attempt_already_issued");
      const fence = next(s.floor);
      this.db.prepare("UPDATE day96_lab_state SET floor=? WHERE resource_id=?").run(fence,s.policy.resourceId);
      this.db.prepare("INSERT INTO day96_lab_capability VALUES(?,?,?,?,?,NULL)")
        .run(s.policy.resourceId,q.requestId,s.policy.attemptId,issueJson(q),fence);
      return outcome("issued",{fence});
    });
  }
  /** Lab controller CAS: revocation and resource-floor publication are one commit.
   * This noon version does not reopen revoked attempts or implement new-key rotation.
   */
  revoke(expected: Day96LabPolicy): Result {
    if (!policyValid(expected)) return outcome("invalid_policy");
    return this.tx(() => {
      const s = this.state(expected.resourceId);
      if (!s || identity(s.policy) !== identity(expected)) return outcome("policy_cas_conflict");
      if (!s.policy.keyActive) return outcome("policy_not_eligible");
      const epoch = next(s.policy.policyEpoch);
      const floor = next(s.floor);
      const revoked = { ...s.policy, policyEpoch:epoch, keyActive:false,
        policySha256:day96LabSha256(JSON.stringify(["day96-lab-revocation",s.policy.policySha256,epoch])) };
      this.db.prepare("UPDATE day96_lab_state SET policy_json=?,floor=? WHERE resource_id=?")
        .run(identity(revoked),floor,expected.resourceId);
      return outcome("revoked",{fence:floor});
    });
  }
  /** Compare and consume + dummy mutation in the same serialized transaction. */
  consume(q: Day96ConsumeRequest): Result {
    if (q?.intent !== "isolated_lab") return outcome("production_release_not_authorized");
    if (!scopeValid(q) || !id(q.requestId) || !id(q.principal) ||
        q.operation !== "dummy_write" || typeof q.command !== "string" ||
        q.command.length > 4096 || !pos(q.fence)) return outcome("invalid_consume_request");
    return this.tx(() => {
      const c = this.cap(q.resourceId,q.requestId);
      if (!c) return outcome("capability_missing");
      const issued = JSON.parse(c.request_json) as Day96IssueRequest;
      const digest = day96LabSha256(q.command);
      if (!scopeEqual(q,issued.expected) || q.principal !== issued.principal ||
          q.operation !== issued.operation || digest !== issued.commandSha256 || q.fence !== c.fence)
        return outcome("capability_binding_conflict");
      // A matching historical receipt is a read, NOT a fresh write authorization.
      if (c.receipt_json !== null) return outcome("exact_effect_replay",{
        receipt:JSON.parse(c.receipt_json) as Day96LabReceipt });
      const s = this.state(q.resourceId);
      if (!s) return outcome("policy_missing");
      if (q.fence !== s.floor) return outcome("stale_fence");
      if (identity(s.policy) !== identity(issued.expected)) return outcome("policy_cas_conflict");
      const now = this.now();
      if (!eligible(s.policy,now) || now >= issued.expiresAtEpochMs)
        return outcome("capability_expired_or_revoked");
      const receipt: Day96LabReceipt = { resourceId:q.resourceId, requestId:q.requestId,
        fence:q.fence, commandSha256:digest, committedAtEpochMs:now };
      this.db.prepare("UPDATE day96_lab_capability SET receipt_json=? WHERE resource_id=? AND request_id=?")
        .run(JSON.stringify(receipt),q.resourceId,q.requestId);
      this.db.prepare("INSERT INTO day96_lab_effect VALUES(?,?,?)").run(q.resourceId,q.requestId,q.command);
      return outcome("effect_committed",{receipt});
    });
  }
  effectCount(resourceId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM day96_lab_effect WHERE resource_id=?")
      .get(resourceId) as { n:number };
    return row.n;
  }
}
