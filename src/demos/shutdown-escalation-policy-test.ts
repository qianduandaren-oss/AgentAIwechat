import { runShutdownWithEscalation } from "../runtime/shutdown-escalation-policy.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const silentLogger = { info: (_message: string) => {}, error: (_message: string, _error?: unknown) => {} };

async function main() {
  const completedHost: { exitCode?: number } = {};
  const completed = await runShutdownWithEscalation(
    { shutdown: async () => {} },
    { timeoutMs: 50, exitHost: completedHost, logger: silentLogger },
  );
  assert(completed.status === "completed", "expected completed");
  assert(completedHost.exitCode === undefined, "successful shutdown must not set failure exit code");

  const failedHost: { exitCode?: number } = {};
  const failed = await runShutdownWithEscalation(
    { shutdown: async () => { throw new Error("boom"); } },
    { timeoutMs: 50, exitHost: failedHost, logger: silentLogger },
  );
  assert(failed.status === "failed", "expected failed");
  assert(failedHost.exitCode === 1, "failed shutdown should set exitCode=1");

  let release!: () => void;
  let underlyingFinished = false;
  const pending = new Promise<void>((resolve) => { release = resolve; }).then(() => { underlyingFinished = true; });
  const deadlineHost: { exitCode?: number } = {};
  const deadline = await runShutdownWithEscalation(
    { shutdown: () => pending },
    { timeoutMs: 5, exitHost: deadlineHost, logger: silentLogger },
  );
  assert(deadline.status === "deadline_exceeded", "expected deadline_exceeded");
  assert(deadlineHost.exitCode === 1, "deadline exceeded should set exitCode=1");
  assert(!underlyingFinished, "deadline must not pretend underlying shutdown finished");
  release();
  await pending;
  assert(underlyingFinished, "underlying shutdown should still be able to finish later");

  console.log("shutdown escalation policy test passed");
}

void main();
