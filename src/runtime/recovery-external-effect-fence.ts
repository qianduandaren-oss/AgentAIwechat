import type { RecoveryAuthorizationEvidence } from "./recovery-authorization-evidence.js";
import {
  assertRecoveryAuthorizationEvidence,
  assertRecoveryAuthorizationRevisionsUnchanged
} from "./recovery-authorization-evidence.js";
import type { DurableRecoveryOperationCommand } from "./durable-recovery-operation-orchestrator.js";
import type { RecoveryClaimOwner } from "./recovery-shared-ownership-claim.js";

/**
 * Day 70 MORNING: external-effect fencing CONTRACT only.
 * This module cannot stop a tool call by itself; an authoritative effect sink
 * must atomically reject stale epochs and deduplicate idempotency keys.
 */
export interface RecoveryExternalEffectIntent {
  command: DurableRecoveryOperationCommand;
  owner: RecoveryClaimOwner;
  effectId: string;
  idempotencyKey: string;
  authorizationEvidence: RecoveryAuthorizationEvidence;
}

/** Trusted authority-issued candidate; never accept this object from request JSON. */
export interface RecoveryExternalEffectFence {
  commandId: string;
  runId: string;
  actorId: string;
  tenantId: string;
  owner: RecoveryClaimOwner;
  effectId: string;
  idempotencyKey: string;
  /** Strictly increasing within the effect authority's own ownership scope. */
  epoch: number;
  authorizationRevisions: RecoveryAuthorizationEvidence["revisions"];
}

export class RecoveryExternalEffectFenceConflictError extends Error {
  constructor() {
    super("Recovery external effect fencing evidence is invalid or stale");
    this.name = "RecoveryExternalEffectFenceConflictError";
  }
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256;
}

/**
 * Checks IDENTITY/BINDING only. A matching token is NOT proof of fresh
 * authorization, an unexpired lease, or downstream exactly-once execution.
 */
export function assertRecoveryExternalEffectFenceBinding(
  intent: RecoveryExternalEffectIntent,
  fence: RecoveryExternalEffectFence | undefined
): asserts fence is RecoveryExternalEffectFence {
  try {
    assertRecoveryAuthorizationEvidence(
      intent.command,
      {
        actorId: intent.authorizationEvidence.actorId,
        tenantId: intent.authorizationEvidence.tenantId
      },
      intent.authorizationEvidence
    );
    if (!fence ||
        !nonempty(intent.effectId) || !nonempty(intent.idempotencyKey) ||
        fence.commandId !== intent.command.commandId ||
        fence.runId !== intent.command.runId ||
        fence.actorId !== intent.command.requestedBy ||
        fence.tenantId !== intent.authorizationEvidence.tenantId ||
        fence.owner !== intent.owner ||
        fence.effectId !== intent.effectId ||
        fence.idempotencyKey !== intent.idempotencyKey ||
        !Number.isSafeInteger(fence.epoch) || fence.epoch < 1) {
      throw new RecoveryExternalEffectFenceConflictError();
    }
    assertRecoveryAuthorizationRevisionsUnchanged(
      intent.authorizationEvidence.revisions,
      fence.authorizationRevisions
    );
  } catch {
    throw new RecoveryExternalEffectFenceConflictError();
  }
}

/**
 * Both implementations are FUTURE integration points, not production adapters.
 * The sink must perform freshness validation and key dedupe together with
 * the actual effect; it must never use a read-only preflight as its fence.
 */
export interface RecoveryExternalEffectAuthority {
  issueFence(intent: RecoveryExternalEffectIntent): Promise<RecoveryExternalEffectFence>;
}

export interface FencedRecoveryExternalEffectSink {
  dispatch(
    intent: RecoveryExternalEffectIntent,
    fence: RecoveryExternalEffectFence
  ): Promise<"committed" | "already_applied">;
}
