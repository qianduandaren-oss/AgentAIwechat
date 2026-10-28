import { strict as assert } from "node:assert";
import {
  RecoveryIngressDeniedError,
  RecoveryIngressGate,
  type AuthenticatedRecoveryPrincipal,
  type RecoveryIngressRequest
} from "../runtime/recovery-ingress-gate.js";
import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import type { RecoveryEntryExecution } from "../runtime/recovery-entry-dispatcher.js";

const principal: AuthenticatedRecoveryPrincipal = {
  actorId: "authenticated-operator", tenantId: "tenant-a"
};
const request: RecoveryIngressRequest = {
  commandId: "day68-command", runId: "day68-run",
  operation: "quarantine", reason: "operator review",
  expectedCheckpointVersion: 1, expectedControlVersion: 0
};

let executionCount = 0;
let lookupCount = 0;
let permissionCount = 0;
let observed: DurableRecoveryOperationCommand | undefined;
const response: RecoveryEntryExecution = {
  route: "atomic_control_only",
  execution: {
    action: "replayed_terminal",
    record: {
      ...request, requestedBy: principal.actorId,
      executionOwner: "atomic_control_only",
      status: "succeeded", version: 3,
      createdAt: "2026-10-28T00:00:00.000Z",
      updatedAt: "2026-10-28T00:00:00.000Z"
    },
    resultSnapshot: {
      status: "quarantined", reason: "run_quarantined",
      checkpointVersion: 1, controlVersion: 1
    }
  }
};
let tenant: string | undefined = "tenant-a";
let permitted = true;
const gate = new RecoveryIngressGate(
  {
    async execute(command) {
      executionCount++;
      observed = command;
      return response;
    }
  },
  {
    async findTenantId(runId) {
      lookupCount++;
      assert.equal(runId, request.runId);
      return tenant;
    }
  },
  {
    async canOperate(actor, operation) {
      permissionCount++;
      assert.equal(actor.actorId, principal.actorId);
      assert.equal(operation, "quarantine");
      return permitted;
    }
  }
);

let passed = 0;
async function rejected(
  input: unknown,
  actor: AuthenticatedRecoveryPrincipal | undefined,
  expectedCode: RecoveryIngressDeniedError["code"]
): Promise<void> {
  const before = executionCount;
  await assert.rejects(
    () => gate.execute(input, actor),
    error => error instanceof RecoveryIngressDeniedError &&
      error.code === expectedCode
  );
  assert.equal(executionCount, before, "no Claim/execution after ingress denial");
  passed++;
}

const first = await gate.execute(request, principal);
assert.equal(first.route, "atomic_control_only");
assert.equal(observed?.requestedBy, principal.actorId);
assert.equal(executionCount, 1);
assert.equal(lookupCount, 1);
assert.equal(permissionCount, 1);
passed++;

// Identity must be trusted, not copied from the request body.
await rejected(request, undefined, "UNAUTHENTICATED");
await rejected(request, { actorId: " ", tenantId: "tenant-a" }, "UNAUTHENTICATED");
await rejected({ ...request, requestedBy: "forged-actor" }, principal, "BAD_REQUEST");
await rejected({ ...request, tenantId: "tenant-b" }, principal, "BAD_REQUEST");
await rejected({ ...request, expectedControlVersion: undefined }, principal, "BAD_REQUEST");
await rejected({ ...request, operation: "delete_everything" }, principal, "BAD_REQUEST");

tenant = "tenant-b";
await rejected(request, principal, "NOT_FOUND");
tenant = undefined;
await rejected(request, principal, "NOT_FOUND");

tenant = "tenant-a";
permitted = false;
await rejected(request, principal, "FORBIDDEN");
assert.equal(executionCount, 1, "only authenticated, scoped, permitted request executed");
console.log(`Day 68 Recovery ingress trust boundary: ${passed}/${passed} passed`);
