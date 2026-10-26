import { RecoveryEntryDispatcher, AtomicRecoveryOperationUnsupportedError } from "../runtime/recovery-entry-dispatcher.js";
import type {
  DurableRecoveryOperationCommand,
  DurableRecoveryOperationExecution
} from "../runtime/durable-recovery-operation-orchestrator.js";
import type { AtomicControlOnlyExecution } from "../runtime/recovery-atomic-control-only-adapter.js";
import type { DurableRecoveryCommandRecord } from "../runtime/recovery-command-store.js";

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error("Day 66 entry ownership: " + label);
}
const command: DurableRecoveryOperationCommand = {
  commandId: "day66-cmd", runId: "day66-run", operation: "quarantine",
  requestedBy: "operator", reason: "review", expectedCheckpointVersion: 1,
  expectedControlVersion: 0
};
const record: DurableRecoveryCommandRecord = {
  ...command, status: "executing", version: 2,
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z"
};
const legacyResult: DurableRecoveryOperationExecution = {
  action: "resume_in_flight", record,
  facts: {
    checkpointVersion: 1,
    checkpointBoundary: "reconciling_tool",
    controlVersion: 0,
    controlStatus: "active"
  }
};

function fixture(
  atomicResult: AtomicControlOnlyExecution = { action: "suspend_in_flight", record },
  atomicError?: Error
) {
  let legacyCalls = 0;
  let atomicCalls = 0;
  const handlers = {
    legacy: {
      async execute(_cmd: DurableRecoveryOperationCommand): Promise<DurableRecoveryOperationExecution> {
        legacyCalls++;
        return legacyResult;
      }
    },
    atomic: {
      async execute(
        _cmd: DurableRecoveryOperationCommand,
        flag: boolean
      ): Promise<AtomicControlOnlyExecution> {
        assert(flag === true, "atomic handler explicitly enabled");
        atomicCalls++;
        if (atomicError) throw atomicError;
        return atomicResult;
      }
    }
  };
  return { handlers, counts: () => ({ legacyCalls, atomicCalls }) };
}
let passed = 0;

// Flag OFF: the caller intentionally selects the unchanged legacy owner.
{
  const f = fixture();
  const result = await new RecoveryEntryDispatcher(f.handlers, false).execute(command);
  assert(result.route === "legacy", "flag off selects legacy exactly once");
  assert(f.counts().legacyCalls === 1 && f.counts().atomicCalls === 0,
    "flag off never reaches new admission");
  passed++;
}

// Flag ON: one atomic owner, including in-flight suspensions.
{
  const f = fixture();
  const result = await new RecoveryEntryDispatcher(f.handlers, true).execute(command);
  assert(result.route === "atomic_control_only" &&
    result.execution.action === "suspend_in_flight", "atomic in-flight stays suspended");
  assert(f.counts().legacyCalls === 0 && f.counts().atomicCalls === 1,
    "atomic route never invokes legacy terminal writer");
  passed++;
}

// Other allowed Control-only operations use the same exclusive owner.
{
  const f = fixture();
  const dispatcher = new RecoveryEntryDispatcher(f.handlers, true);
  await dispatcher.execute({ ...command, operation: "release_quarantine" });
  await dispatcher.execute({ ...command, operation: "dead_letter" });
  assert(f.counts().legacyCalls === 0 && f.counts().atomicCalls === 2,
    "all Control-only operations keep atomic ownership");
  passed++;
}

// Unsupported operation must be rejected BEFORE either handler runs.
{
  const f = fixture();
  let rejected = false;
  try { await new RecoveryEntryDispatcher(f.handlers, true)
    .execute({ ...command, operation: "resume" }); }
  catch (error) { rejected = error instanceof AtomicRecoveryOperationUnsupportedError; }
  assert(rejected, "unsupported atomic operation fails closed");
  assert(f.counts().legacyCalls === 0 && f.counts().atomicCalls === 0,
    "no handler executes on unsupported atomic command");
  passed++;
}

// The most important crash rule: atomic exception is not legacy fallback.
{
  const f = fixture(undefined, new Error("commit_response_lost"));
  let failed = false;
  try { await new RecoveryEntryDispatcher(f.handlers, true).execute(command); }
  catch (error) { failed = (error as Error).message === "commit_response_lost"; }
  assert(failed, "atomic error propagates to caller for durable reconciliation");
  assert(f.counts().legacyCalls === 0 && f.counts().atomicCalls === 1,
    "atomic error NEVER calls legacy as fallback");
  passed++;
}

// Invalid handler response fails instead of changing owner.
{
  const f = fixture({ action: "legacy_unchanged" });
  let failed = false;
  try { await new RecoveryEntryDispatcher(f.handlers, true).execute(command); }
  catch { failed = true; }
  assert(failed, "unexpected atomic return action is rejected");
  assert(f.counts().legacyCalls === 0, "unexpected return cannot trigger legacy handler");
  passed++;
}

console.log(`Day 66 Recovery entry single-writer routing: ${passed}/${passed} passed`);
