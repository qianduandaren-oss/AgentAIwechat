import { ShutdownCoordinator, type DrainableRuntime, type ServerHost } from "../runtime/shutdown-coordinator.js";

const events: string[] = [];
let releaseDrain!: () => void;
const drainGate = new Promise<void>(resolve => { releaseDrain = resolve; });

const server: ServerHost = {
  async close() {
    events.push("server.close");
  },
};

const runtime: DrainableRuntime = {
  async drain() {
    events.push("runtime.drain:start");
    await drainGate;
    events.push("runtime.drain:end");
  },
};

const coordinator = new ShutdownCoordinator(server, runtime);
const first = coordinator.shutdown();
const second = coordinator.shutdown();

if (first !== second) throw new Error("shutdown must return the same in-flight promise");
if (coordinator.snapshot().state !== "shutting_down") throw new Error("expected shutting_down state");

await Promise.resolve();
if (events.join(",") !== "server.close") throw new Error(`unexpected first step: ${events.join(",")}`);
await Promise.resolve();
if (events.join(",") !== "server.close,runtime.drain:start") throw new Error(`runtime did not drain after server close: ${events.join(",")}`);

releaseDrain();
await first;

if (coordinator.snapshot().state !== "stopped") throw new Error("expected stopped state");
if (events.join(",") !== "server.close,runtime.drain:start,runtime.drain:end") throw new Error(`unexpected shutdown order: ${events.join(",")}`);

const third = coordinator.shutdown();
if (third !== first) throw new Error("shutdown must stay idempotent after completion");

console.log("shutdown coordinator test passed", events);
