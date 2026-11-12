import type {
  RecoveryWriterOperation,
  RecoveryWriterRequestHandler,
  RecoveryWriterWireResponse,
  VerifiedTransportCaller
} from "./recovery-writer-rpc-contract.js";
import { parseRecoveryWriterWireRequest } from "./recovery-writer-rpc-handler.js";

/**
 * Day 81 evening: IN-PROCESS candidate admission boundary.
 * Neither the caller object nor this ledger authenticates a network peer.
 * Replays are bounded per process, NOT durable request deduplication.
 */
export interface WriterRpcAuditEvent {
  readonly requestId: string;
  readonly subject: string;
  readonly operation: RecoveryWriterOperation;
  readonly decision: "admitted";
}

export interface WriterRpcAdmissionDependencies {
  /** Read the server's CURRENT authorization policy; never trust request JSON. */
  reauthorize(caller: VerifiedTransportCaller, operation: RecoveryWriterOperation): Promise<boolean>;
  /** Day 83 lab: recheck shared durable watermark and authenticated policy source immediately before delegation. */
  beforeDelegate?(caller: VerifiedTransportCaller, operation: RecoveryWriterOperation): Promise<boolean>;
  /** Synchronous pre-dispatch audit. On failure no work is dispatched. */
  recordAudit(event: WriterRpcAuditEvent): void;
  /** Server clock, not the client's timestamp. */
  nowEpochMs(): number;
  maxInFlightPerSubject: number;
  replayTtlMs: number;
  maxReplayKeys: number;
}

export interface WriterRpcAdmissionControl {
  /** A SERVER-side admission deadline; it does not cancel a dispatched write. */
  readonly deadlineEpochMs?: number;
  readonly signal?: AbortSignal;
}

const SAFE_SUBJECT = /^[A-Za-z0-9._:-]{1,128}$/;
type Hold = Extract<RecoveryWriterWireResponse, { action: "hold" }>;
const hold = (requestId: string, reason: string): Hold =>
  ({ requestId, action: "hold", reason });

export class RecoveryWriterRpcAdmissionHandler implements RecoveryWriterRequestHandler {
  private readonly activeCounts = new Map<string, number>();
  private readonly activeKeys = new Set<string>();
  private readonly recent = new Map<string, number>();
  private lastClock = 0;

  constructor(
    private readonly delegate: RecoveryWriterRequestHandler,
    private readonly deps: WriterRpcAdmissionDependencies
  ) {
    if (!Number.isSafeInteger(deps.maxInFlightPerSubject) || deps.maxInFlightPerSubject < 1 ||
        !Number.isSafeInteger(deps.maxReplayKeys) || deps.maxReplayKeys < 1 ||
        !Number.isSafeInteger(deps.replayTtlMs) || deps.replayTtlMs < 1 ||
        deps.replayTtlMs > 600_000) {
      throw new Error("invalid_candidate_admission_configuration");
    }
  }

  private clock(): number | null {
    try {
      const now = this.deps.nowEpochMs();
      if (!Number.isSafeInteger(now) || now < 0 || now < this.lastClock) return null;
      this.lastClock = now;
      return now;
    } catch {
      return null;
    }
  }

  private prune(now: number): void {
    for (const [key, expires] of this.recent) {
      if (expires <= now && !this.activeKeys.has(key)) this.recent.delete(key);
    }
  }

  async handle(
    raw: unknown,
    caller: VerifiedTransportCaller | null,
    control: WriterRpcAdmissionControl = {}
  ): Promise<RecoveryWriterWireResponse> {
    const parsed = parseRecoveryWriterWireRequest(raw);
    if (parsed.action === "hold") return parsed;
    const { request } = parsed;
    const id = request.requestId;
    if (!caller || !SAFE_SUBJECT.test(caller.subject) ||
        (caller.mechanism !== "verified_peer_identity" && caller.mechanism !== "mutual_tls") ||
        !Array.isArray(caller.grantedOperations) ||
        !caller.grantedOperations.includes(request.operation)) {
      return hold(id, "transport_identity_or_permission_denied");
    }

    const now = this.clock();
    if (now === null) return hold(id, "admission_clock_unavailable");
    if (control.deadlineEpochMs !== undefined &&
        (!Number.isSafeInteger(control.deadlineEpochMs) || control.deadlineEpochMs < 0)) {
      return hold(id, "invalid_server_deadline");
    }
    if (control.signal?.aborted || (control.deadlineEpochMs !== undefined && now >= control.deadlineEpochMs)) {
      return hold(id, "admission_cancelled_or_expired");
    }
    this.prune(now);

    // Only this process sees the ledger; a restart or second replica does not.
    const key = JSON.stringify([caller.subject, id]);
    if (this.recent.has(key) || this.activeKeys.has(key)) return hold(id, "candidate_request_replay");
    if ((this.activeCounts.get(caller.subject) ?? 0) >= this.deps.maxInFlightPerSubject) {
      return hold(id, "candidate_concurrency_exceeded");
    }
    if (this.recent.size >= this.deps.maxReplayKeys || !Number.isSafeInteger(now + this.deps.replayTtlMs)) {
      return hold(id, "candidate_replay_window_full");
    }

    // Reserve synchronously BEFORE awaiting the policy source.
    this.recent.set(key, now + this.deps.replayTtlMs);
    this.activeKeys.add(key);
    this.activeCounts.set(caller.subject, (this.activeCounts.get(caller.subject) ?? 0) + 1);
    let dispatched = false;
    try {
      let allowed = false;
      try {
        allowed = await this.deps.reauthorize(caller, request.operation);
      } catch {
        return hold(id, "authorization_source_unavailable");
      }
      if (!allowed) return hold(id, "authorization_revoked");
      const beforeDispatch = this.clock();
      if (beforeDispatch === null) return hold(id, "admission_clock_unavailable");
      if (control.signal?.aborted ||
          (control.deadlineEpochMs !== undefined && beforeDispatch >= control.deadlineEpochMs)) {
        return hold(id, "admission_cancelled_or_expired");
      }

      // A different instance may have advanced the durable trust watermark while
      // this call awaited ACL. Reject before auditing/delegating if our active
      // policy is stale. This is NOT atomic with another process's future CAS.
      if (this.deps.beforeDelegate) {
        let currentTrust = false;
        try {
          currentTrust = await this.deps.beforeDelegate(caller, request.operation);
        } catch {
          return hold(id, "durable_trust_verification_unavailable");
        }
        if (!currentTrust) return hold(id, "durable_trust_stale_or_unavailable");
        const checkedAt = this.clock();
        if (checkedAt === null) return hold(id, "admission_clock_unavailable");
        if (control.signal?.aborted ||
            (control.deadlineEpochMs !== undefined && checkedAt >= control.deadlineEpochMs)) {
          return hold(id, "admission_cancelled_or_expired");
        }
      }

      // No rawConsumerResponse, eventId, leaseToken or arbitrary payloads in audit.
      try {
        this.deps.recordAudit({
          requestId: id, subject: caller.subject, operation: request.operation, decision: "admitted"
        });
      } catch {
        return hold(id, "audit_unavailable");
      }

      // Once dispatched, cancellation cannot roll back an ACK / SQLite side effect.
      dispatched = true;
      return await this.delegate.handle(raw, caller);
    } catch {
      return hold(id, "writer_rpc_outcome_unknown");
    } finally {
      this.activeKeys.delete(key);
      const remaining = (this.activeCounts.get(caller.subject) ?? 1) - 1;
      if (remaining <= 0) this.activeCounts.delete(caller.subject);
      else this.activeCounts.set(caller.subject, remaining);
      if (!dispatched) this.recent.delete(key);
    }
  }
}
