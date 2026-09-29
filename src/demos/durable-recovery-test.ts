import type { AgentToolCall } from "../llm/types.js";
import { SecureToolExecutor } from "../security/secure-tool-executor.js";
import { getToolEffectPolicy } from "../security/tool-effect-policy.js";
import { ToolRegistry } from "../tools/registry.js";
import {
  createInitialCheckpoint,
  type ToolExecutionRecord
} from "../runtime/checkpoint.js";
import {
  CheckpointConflictError,
  InMemoryCheckpointStore
} from "../runtime/checkpoint-store.js";
import { DurableToolExecutor } from "../runtime/durable-tool-executor.js";
import { planRecovery } from "../runtime/recovery-planner.js";
import { ReconcilerRegistry } from "../runtime/reconciler.js";
import { recoverToolExecution } from "../runtime/recovery-runtime.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function testCheckpointCAS(): Promise<void> {
  const store = new InMemoryCheckpointStore();
  const initial = createInitialCheckpoint("run-cas");
  const v1 = await store.save(initial, 0);

  const v2 = await store.save(
    { ...v1, boundary: "ready_for_tool" },
    v1.version
  );
  assert(v2.version === 2, "successful save should increment version");

  let conflicted = false;
  try {
    await store.save(
      { ...v1, boundary: "completed" },
      v1.version
    );
  } catch (error) {
    conflicted = error instanceof CheckpointConflictError;
  }
  assert(conflicted, "stale checkpoint write should fail with conflict");
}

function testRecoveryPlanner(): void {
  const searchPolicy = getToolEffectPolicy("search_customer");
  const searchPlan = planRecovery({
    outcome: "started",
    sideEffect: searchPolicy.sideEffect,
    retrySafe: searchPolicy.retrySafe,
    hasIdempotencyKey: false,
    canReconcile: false
  });
  assert(searchPlan.action === "retry", "side-effect-free query should retry");

  const refundPolicy = getToolEffectPolicy("execute_refund");
  const refundPlan = planRecovery({
    outcome: "started",
    sideEffect: refundPolicy.sideEffect,
    retrySafe: refundPolicy.retrySafe,
    hasIdempotencyKey: true,
    canReconcile: true
  });
  assert(refundPlan.action === "reconcile", "uncertain refund should reconcile");

  const messagePolicy = getToolEffectPolicy("send_message");
  const messagePlan = planRecovery({
    outcome: "started",
    sideEffect: messagePolicy.sideEffect,
    retrySafe: messagePolicy.retrySafe,
    hasIdempotencyKey: false,
    canReconcile: false
  });
  assert(messagePlan.action === "suspend", "unsafe unknown side effect should suspend");
}

async function testReconciliation(): Promise<void> {
  const registry = new ReconcilerRegistry();
  registry.register("execute_refund", {
    async reconcile({ idempotencyKey }) {
      return idempotencyKey === "refund_req_001"
        ? "executed"
        : "unknown";
    }
  });

  const record: ToolExecutionRecord = {
    toolCallId: "call-refund",
    toolName: "execute_refund",
    outcome: "started",
    idempotencyKey: "refund_req_001",
    sideEffect: "external_side_effect",
    retrySafe: false
  };

  const resolution = await recoverToolExecution(record, registry);
  assert(resolution.plan.action === "reconcile", "refund should reconcile first");
  assert(resolution.resolvedOutcome === "executed", "reconciler should confirm execution");
  assert(resolution.nextPlan?.action === "skip", "confirmed execution must not run again");
}

async function testDurableToolExecution(): Promise<void> {
  const registry = new ToolRegistry();
  let receivedIdempotencyKey: string | undefined;

  registry.register(
    {
      name: "search_customer",
      description: "search customer",
      inputSchema: {
        type: "object",
        properties: {
          customerId: { type: "string" }
        }
      }
    },
    async (_args, context) => {
      receivedIdempotencyKey = context?.idempotencyKey;
      return { found: true };
    }
  );

  const secureExecutor = new SecureToolExecutor(registry);
  const checkpointStore = new InMemoryCheckpointStore();
  const durableExecutor = new DurableToolExecutor(
    secureExecutor,
    checkpointStore
  );

  const call: AgentToolCall = {
    id: "call-search-1",
    name: "search_customer",
    arguments: { customerId: "customer-1" }
  };

  const result = await durableExecutor.execute(call, {
    runId: "run-search",
    step: 1
  });

  assert(result.execution.status === "executed", "tool should execute");
  assert(result.record.outcome === "executed", "checkpoint should record executed");
  assert(result.checkpoint.boundary === "ready_for_next_step", "boundary should advance");
  assert(result.checkpoint.version === 2, "intent and outcome should create two versions");
  assert(
    receivedIdempotencyKey === result.record.idempotencyKey,
    "same idempotency key should reach the real tool handler"
  );
}

await testCheckpointCAS();
testRecoveryPlanner();
await testReconciliation();
await testDurableToolExecution();

console.log("durable recovery tests passed");
