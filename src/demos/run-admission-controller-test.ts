import {
  RunAdmissionController,
  RunCancelledError,
  RunOverloadedError,
  RunQueueTimeoutError
} from "../runtime/run-admission-controller.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const controller = new RunAdmissionController({ maxConcurrentRuns: 1, maxQueuedRuns: 2 });
const releaseA = await controller.acquire();
const abortController = new AbortController();
const waitingB = controller.acquire({ signal: abortController.signal });
const waitingC = controller.acquire({ timeoutMs: 25 });

assert(controller.snapshot().activeRuns === 1, "one run should be active");
assert(controller.snapshot().queuedRuns === 2, "two runs should be queued");

let overloaded = false;
try { await controller.acquire(); } catch (error) { overloaded = error instanceof RunOverloadedError; }
assert(overloaded, "fourth run should be rejected as overloaded");

abortController.abort();
let cancelled = false;
try { await waitingB; } catch (error) { cancelled = error instanceof RunCancelledError; }
assert(cancelled, "aborted waiter should reject with RunCancelledError");
assert(controller.snapshot().queuedRuns === 1, "cancelled waiter must be removed from queue");

let timedOut = false;
try { await waitingC; } catch (error) { timedOut = error instanceof RunQueueTimeoutError; }
assert(timedOut, "expired waiter should reject with RunQueueTimeoutError");
assert(controller.snapshot().queuedRuns === 0, "timed-out waiter must be removed from queue");

releaseA();
assert(controller.snapshot().activeRuns === 0, "active slot should be released without ghost waiters");

const releaseD = await controller.acquire({ timeoutMs: 50 });
assert(controller.snapshot().activeRuns === 1, "new run should still be admitted after timeout/cancel cleanup");
releaseD();
assert(controller.snapshot().activeRuns === 0, "all slots should be released");

console.log("run admission controller timeout/cancellation test passed");
