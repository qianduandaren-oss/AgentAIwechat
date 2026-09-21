import { RuntimeDrainingError, RuntimeLifecycle } from "../runtime/runtime-lifecycle.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const lifecycle = new RuntimeLifecycle();
const leaveA = lifecycle.enterRun();
const leaveB = lifecycle.enterRun();
assert(lifecycle.snapshot().activeRuns === 2, "two runs should be active");

lifecycle.beginDrain();
assert(lifecycle.snapshot().state === "DRAINING", "runtime should enter DRAINING");

let rejected = false;
try { lifecycle.enterRun(); } catch (error) { rejected = error instanceof RuntimeDrainingError; }
assert(rejected, "new run should be rejected while draining");

const drained = lifecycle.waitForDrain();
leaveA();
assert(lifecycle.snapshot().state === "DRAINING", "one active run should keep runtime draining");
leaveB();
await drained;
assert(lifecycle.snapshot().state === "STOPPED", "runtime should stop after all active runs leave");
assert(lifecycle.snapshot().activeRuns === 0, "no active runs should remain");

console.log("runtime lifecycle draining test passed");
