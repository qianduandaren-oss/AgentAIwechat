import type { RecoveryCommandResultSnapshot } from "./recovery-command-store.js";
import {
  RecoveryIngressDeniedError,
  type AuthenticatedRecoveryPrincipal,
  type RecoveryIngressGate
} from "./recovery-ingress-gate.js";
import { RecoveryCommandIdentityConflictError } from "./durable-recovery-operation-orchestrator.js";
import { RecoverySharedOwnershipConflictError } from "./recovery-shared-ownership-claim.js";
import { RecoveryFinalizationConflictError } from "./sqlite-recovery-finalization.js";
import { RecoveryAuthorizationEvidenceConflictError } from "./recovery-authorization-evidence.js";
import { RecoveryTerminalSnapshotMissingError } from "./recovery-atomic-route-decision.js";
import {
  AtomicRecoveryOperationUnsupportedError,
  RecoveryEntryOwnershipConflictError
} from "./recovery-entry-dispatcher.js";

/**
 * Day 68 noon: framework-independent, sanitized HTTP RESPONSE CONTRACT.
 * Not a web server, authentication implementation, or production route.
 * The gate must already be assembled using a ClaimRequiredRecoveryEntry.
 * Never construct principal from client-supplied headers or JSON here.
 */
export interface RecoveryIngressResponse {
  status: 200 | 202 | 400 | 401 | 403 | 404 | 409 | 500 | 503;
  body: {
    code: string;
    route?: "legacy" | "atomic_control_only";
    action?: "executed_new" | "replayed_terminal" | "in_flight";
    result?: RecoveryCommandResultSnapshot;
  };
}

function failure(status: RecoveryIngressResponse["status"], code: string): RecoveryIngressResponse {
  // Never expose internal Error.message, raw database rows, or tenant/run facts.
  return { status, body: { code } };
}

export async function handleRecoveryIngressResponse(
  gate: RecoveryIngressGate,
  input: unknown,
  authenticatedPrincipal: AuthenticatedRecoveryPrincipal | undefined
): Promise<RecoveryIngressResponse> {
  try {
    const result = await gate.execute(input, authenticatedPrincipal);
    const execution = result.execution;

    if (execution.action === "resume_in_flight" ||
        execution.action === "suspend_in_flight") {
      return {
        status: 202,
        body: { code: "IN_FLIGHT", route: result.route, action: "in_flight" }
      };
    }

    // Never manufacture a terminal response for an incomplete historic command.
    if (!execution.resultSnapshot) {
      return failure(503, "TERMINAL_SNAPSHOT_UNAVAILABLE");
    }

    return {
      status: 200,
      body: {
        code: "OK",
        route: result.route,
        action: execution.action,
        result: structuredClone(execution.resultSnapshot)
      }
    };
  } catch (error) {
    if (error instanceof RecoveryIngressDeniedError) {
      const statuses: Record<RecoveryIngressDeniedError["code"], RecoveryIngressResponse["status"]> = {
        BAD_REQUEST: 400,
        UNAUTHENTICATED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404
      };
      return failure(statuses[error.code], error.code);
    }
    if (error instanceof AtomicRecoveryOperationUnsupportedError) {
      return failure(400, "UNSUPPORTED_OPERATION");
    }
    if (error instanceof RecoveryAuthorizationEvidenceConflictError ||
        error instanceof RecoveryCommandIdentityConflictError ||
        error instanceof RecoveryEntryOwnershipConflictError ||
        error instanceof RecoverySharedOwnershipConflictError ||
        error instanceof RecoveryFinalizationConflictError) {
      return failure(409, "RECOVERY_CONFLICT");
    }
    if (error instanceof RecoveryTerminalSnapshotMissingError) {
      return failure(503, "TERMINAL_SNAPSHOT_UNAVAILABLE");
    }
    // Infrastructure failure / post-COMMIT reply loss must NEVER trigger
    // a legacy fallback or retry. Only return a generic error.
    return failure(500, "RECOVERY_UNAVAILABLE");
  }
}
