import type { DurableRecoveryCommandRecord } from "../runtime/recovery-command-store.js";
import { RecoveryIngressGate, type RecoveryIngressExecutor } from "../runtime/recovery-ingress-gate.js";
import { handleRecoveryIngressResponse } from "../runtime/recovery-ingress-response.js";
import { RecoveryEntryOwnershipConflictError } from "../runtime/recovery-entry-dispatcher.js";

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error("Day 68 evening contract: " + label);
}

const principal = { actorId: "operator-a", tenantId: "tenant-a" };
const request = {
  commandId: "day68-evening-command",
  runId: "day68-evening-run",
  operation: "quarantine" as const,
  reason: "investigate uncertain effect",
  expectedCheckpointVersion: 1,
  expectedControlVersion: 0
};
const snapshot = {
  status: "quarantined" as const,
  reason: "quarantine persisted",
  checkpointVersion: 1,
  controlVersion: 1
};
const terminal: DurableRecoveryCommandRecord = {
  ...request,
  requestedBy: principal.actorId,
  status: "succeeded",
  version: 3,
  executionOwner: "atomic_control_only",
  createdAt: "2026-10-28T10:00:00.000Z",
  updatedAt: "2026-10-28T10:00:00.000Z",
  resultSnapshot: snapshot
};

let permitted = true;
let tenant: string | undefined = "tenant-a";
let entryCalls = 0;
let mode: "replay" | "inflight" | "snapshot_missing" | "owner_conflict" | "internal_error" =
  "replay";

const entry: RecoveryIngressExecutor = {
  async execute(command) {
    entryCalls++;
    check(command.requestedBy === "operator-a", "requestedBy must be derived from principal");
    if (mode === "owner_conflict") {
      throw new RecoveryEntryOwnershipConflictError(
        command.commandId, "legacy", "atomic_control_only"
      );
    }
    if (mode === "internal_error") {
      throw new Error("SQLite path /private/db.sqlite, token secret-should-not-leak");
    }
    if (mode === "inflight") {
      return {
        route: "atomic_control_only",
        execution: {
          action: "suspend_in_flight",
          record: { ...terminal, status: "executing", version: 2, resultSnapshot: undefined }
        }
      };
    }
    if (mode === "snapshot_missing") {
      return {
        route: "atomic_control_only",
        execution: {
          action: "replayed_terminal",
          record: { ...terminal, resultSnapshot: undefined }
        }
      };
    }
    return {
      route: "atomic_control_only",
      execution: { action: "replayed_terminal", record: terminal, resultSnapshot: snapshot }
    };
  }
};

const gate = new RecoveryIngressGate(
  entry,
  { async findTenantId(runId) {
    check(runId === request.runId, "run directory lookup");
    return tenant;
  } },
  { async canOperate(actor, operation) {
    return permitted && actor.actorId === "operator-a" &&
      actor.tenantId === "tenant-a" && operation === "quarantine";
  } }
);

let passed = 0;
async function expect(
  input: unknown,
  actor: typeof principal | undefined,
  status: number,
  code: string,
  shouldCallEntry: boolean
) {
  const before = entryCalls;
  const response = await handleRecoveryIngressResponse(gate, input, actor);
  check(response.status === status && response.body.code === code,
    `expected ${status}/${code}, got ${response.status}/${response.body.code}`);
  check(entryCalls - before === (shouldCallEntry ? 1 : 0),
    "wrong invocation count across ingress boundary");
  if (status !== 200) check(!response.body.result, "non-200 response leaked snapshot");
  passed++;
  return response;
}

// Authenticated terminal replay: no untrusted field controls the actor identity.
const ok = await expect(request, principal, 200, "OK", true);
check(ok.body.action === "replayed_terminal" &&
  ok.body.result?.controlVersion === 1, "authorized replay");
check(ok.body.result !== snapshot, "response must clone result snapshot");

// Revocation takes effect BEFORE replay: the executor is never invoked.
permitted = false;
await expect(request, principal, 403, "FORBIDDEN", false);
permitted = true;

// Tenant and identity checks remain mandatory for historical results.
tenant = "tenant-b";
await expect(request, principal, 404, "NOT_FOUND", false);
tenant = "tenant-a";
await expect(request, undefined, 401, "UNAUTHENTICATED", false);
await expect({ ...request, requestedBy: "operator-a" }, principal, 400, "BAD_REQUEST", false);
await expect({ ...request, tenantId: "tenant-a" }, principal, 400, "BAD_REQUEST", false);

// The old preflight owner guard has its own conflict type: never leak details or reply 500.
mode = "owner_conflict";
await expect(request, principal, 409, "RECOVERY_CONFLICT", true);

// An incomplete historic terminal must not be presented as success.
mode = "snapshot_missing";
await expect(request, principal, 503, "TERMINAL_SNAPSHOT_UNAVAILABLE", true);

// executing v2 means investigation/suspend, not replay or another business execution.
mode = "inflight";
const pending = await expect(request, principal, 202, "IN_FLIGHT", true);
check(pending.body.action === "in_flight", "in-flight response contract");

// Infrastructure error is sanitized and never triggers a legacy fallback.
mode = "internal_error";
const unexpected = await expect(request, principal, 500, "RECOVERY_UNAVAILABLE", true);
check(!JSON.stringify(unexpected).includes("SQLite") &&
  !JSON.stringify(unexpected).includes("secret"), "internal error escaped");

// Invalid operations must be rejected before the executor.
await expect({ ...request, operation: "invoke_any_tool" }, principal, 400, "BAD_REQUEST", false);

console.log(`Day 68 evening ingress response and cutover boundary: ${passed}/11 passed`);
