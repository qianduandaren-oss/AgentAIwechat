import { runShutdownWithDeadline } from "../runtime/shutdown-deadline-runner.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function testCompleted(): Promise<void> {
  const result = await runShutdownWithDeadline(
    { shutdown: async () => undefined },
    { timeoutMs: 50 },
  );
  assert(result.status === "completed", "expected completed");
}

async function testFailed(): Promise<void> {
  const result = await runShutdownWithDeadline(
    { shutdown: async () => { throw new Error("close failed"); } },
    { timeoutMs: 50 },
  );
  assert(result.status === "failed", "expected failed");
}

async function testDeadlineDoesNotCancelUnderlyingShutdown(): Promise<void> {
  let finish!: () => void;
  let completed = false;
  const pending = new Promise<void>((resolve) => { finish = resolve; });

  const target = {
    shutdown: async () => {
      await pending;
      completed = true;
    },
  };

  const result = await runShutdownWithDeadline(target, { timeoutMs: 5 });
  assert(result.status === "deadline_exceeded", "expected deadline_exceeded");
  assert(completed === false, "shutdown should still be pending at deadline");

  finish();
  await pending;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert(completed === true, "underlying shutdown should still be able to finish");
}

await testCompleted();
await testFailed();
await testDeadlineDoesNotCancelUnderlyingShutdown();
console.log("shutdown deadline runner tests passed");
