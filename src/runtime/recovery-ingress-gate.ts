import type { DurableRecoveryOperationCommand } from "./durable-recovery-operation-orchestrator.js";
import type { RecoveryOperation } from "./recovery-operations.js";
import type { RecoveryEntryExecution } from "./recovery-entry-dispatcher.js";

/**
 * Day 68: candidate authenticated Recovery ingress boundary.
 * A principal MUST be supplied by trusted server authentication middleware.
 * This class does not parse JWTs or establish a production HTTP route.
 * The only executor should be a ClaimRequiredRecoveryEntry backed by shared
 * transactional ownership; never pass the pre-claim legacy orchestrator here.
 */
export interface AuthenticatedRecoveryPrincipal {
  actorId: string;
  tenantId: string;
}

export interface RecoveryIngressRunDirectory {
  /** Missing and foreign runs are deliberately indistinguishable to clients. */
  findTenantId(runId: string): Promise<string | undefined>;
}

export interface RecoveryIngressPermissionPolicy {
  /** Authorization for this actor, tenant AND operation; not client requestedBy. */
  canOperate(
    principal: AuthenticatedRecoveryPrincipal,
    operation: RecoveryOperation
  ): Promise<boolean>;
}

export interface RecoveryIngressExecutor {
  execute(command: DurableRecoveryOperationCommand): Promise<RecoveryEntryExecution>;
}

export interface RecoveryIngressRequest {
  commandId: string;
  runId: string;
  operation: RecoveryOperation;
  reason: string;
  expectedCheckpointVersion: number;
  expectedControlVersion: number;
}

export type RecoveryIngressErrorCode =
  "UNAUTHENTICATED" | "BAD_REQUEST" | "NOT_FOUND" | "FORBIDDEN";

export class RecoveryIngressDeniedError extends Error {
  constructor(public readonly code: RecoveryIngressErrorCode) {
    super(`Recovery ingress denied: ${code}`);
    this.name = "RecoveryIngressDeniedError";
  }
}

const OPERATIONS: ReadonlySet<string> = new Set([
  "retry_recovery", "reconcile_again", "quarantine",
  "release_quarantine", "resume", "dead_letter"
]);
const ALLOWED_KEYS = new Set([
  "commandId", "runId", "operation", "reason",
  "expectedCheckpointVersion", "expectedControlVersion"
]);

function nonempty(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 && value.length <= maxLength;
}
function version(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) && value >= 0;
}

export function parseRecoveryIngressRequest(input: unknown): RecoveryIngressRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RecoveryIngressDeniedError("BAD_REQUEST");
  }
  const body = input as Record<string, unknown>;
  // Fail closed rather than silently accepting client-supplied actor/tenant.
  if (Object.keys(body).some(key => !ALLOWED_KEYS.has(key)) ||
      !nonempty(body.commandId, 128) ||
      !nonempty(body.runId, 128) ||
      !nonempty(body.reason, 500) ||
      typeof body.operation !== "string" ||
      !OPERATIONS.has(body.operation) ||
      !version(body.expectedCheckpointVersion) ||
      !version(body.expectedControlVersion)) {
    throw new RecoveryIngressDeniedError("BAD_REQUEST");
  }
  return {
    commandId: body.commandId,
    runId: body.runId,
    operation: body.operation as RecoveryOperation,
    reason: body.reason,
    expectedCheckpointVersion: body.expectedCheckpointVersion,
    expectedControlVersion: body.expectedControlVersion
  };
}

export class RecoveryIngressGate {
  constructor(
    private readonly entry: RecoveryIngressExecutor,
    private readonly runs: RecoveryIngressRunDirectory,
    private readonly policy: RecoveryIngressPermissionPolicy
  ) {}

  async execute(
    input: unknown,
    principal: AuthenticatedRecoveryPrincipal | undefined
  ): Promise<RecoveryEntryExecution> {
    // This is only an in-process trust boundary: the upstream adapter MUST
    // authenticate the principal and never construct it from request JSON.
    if (!principal ||
        !nonempty(principal.actorId, 128) ||
        !nonempty(principal.tenantId, 128)) {
      throw new RecoveryIngressDeniedError("UNAUTHENTICATED");
    }
    const request = parseRecoveryIngressRequest(input);
    const runTenant = await this.runs.findTenantId(request.runId);
    if (!runTenant || runTenant !== principal.tenantId) {
      throw new RecoveryIngressDeniedError("NOT_FOUND");
    }
    if (!(await this.policy.canOperate(principal, request.operation))) {
      throw new RecoveryIngressDeniedError("FORBIDDEN");
    }

    // RequestedBy is derived from server-verified principal, never request body.
    // No Command Claim, executor, legacy write or tool call occurs before checks.
    return this.entry.execute({
      ...request,
      requestedBy: principal.actorId
    });
  }
}
