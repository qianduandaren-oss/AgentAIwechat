import { RunAdmissionController, RunOverloadedError } from "../runtime/run-admission-controller.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const controller = new RunAdmissionController({ maxConcurrentRuns: 2, maxQueuedRuns: 2 });
const releaseA = await controller.acquire();
const releaseB = await controller.acquire();
const waitingC = controller.acquire();
const waitingD = controller.acquire();

assert(controller.snapshot().activeRuns === 2, "two runs should be active");
assert(controller.snapshot().queuedRuns === 2, "two runs should be queued");

let overloaded = false;
try {
  await controller.acquire();
} catch (error) {
  overloaded = error instanceof RunOverloadedError;
}
assert(overloaded, "fifth run should be rejected as overloaded");

releaseA();
const releaseC = await waitingC;
assert(controller.snapshot().activeRuns === 2, "a queued run should take the released slot");
assert(controller.snapshot().queuedRuns === 1, "one run should remain queued");

releaseB();
const releaseD = await waitingD;
assert(controller.snapshot().activeRuns === 2, "second queued run should be admitted");
assert(controller.snapshot().queuedRuns === 0, "queue should be empty");

releaseC();
releaseD();
assert(controller.snapshot().activeRuns === 0, "all slots should be released");
console.log("run admission controller test passed");
