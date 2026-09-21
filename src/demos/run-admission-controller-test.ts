import {
  RunAdmissionClosedError,
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

const drainingController = new RunAdmissionController({ maxConcurrentRuns: 1, maxQueuedRuns: 2 });
const releaseRunning = await drainingController.acquire();
const queued = drainingController.acquire();
assert(drainingController.snapshot().queuedRuns === 1, "one run should wait before drain");
drainingController.close();
assert(drainingController.snapshot().accepting === false, "controller should stop accepting work");
assert(drainingController.snapshot().queuedRuns === 0, "close should remove queued waiters");
let queuedRejected = false;
try { await queued; } catch (error) { queuedRejected = error instanceof RunAdmissionClosedError; }
assert(queuedRejected, "queued run should reject when draining starts");
let newRejected = false;
try { await drainingController.acquire(); } catch (error) { newRejected = error instanceof RunAdmissionClosedError; }
assert(newRejected, "new run should be rejected after close");
releaseRunning();
assert(drainingController.snapshot().activeRuns === 0, "active run may finish naturally while draining");

console.log("run admission controller timeout/cancellation/draining test passed");
