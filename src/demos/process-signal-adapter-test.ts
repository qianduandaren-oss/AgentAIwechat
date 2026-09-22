import { installProcessSignalAdapter, type ProcessSignalHost } from "../runtime/process-signal-adapter.js";
import { ShutdownCoordinator } from "../runtime/shutdown-coordinator.js";

const events: string[] = [];
const listeners = new Map<string, () => void>();

const processHost: ProcessSignalHost = {
  once(signal, listener) {
    listeners.set(signal, listener);
  },
  exitCode: 0,
};

const server = {
  async close() {
    events.push("server.close");
  },
};

const runtime = {
  async drain() {
    events.push("runtime.drain");
  },
};

const logger = {
  info(message: string) { events.push(message); },
  error(message: string) { events.push(message); },
};

const coordinator = new ShutdownCoordinator(server, runtime);
installProcessSignalAdapter(coordinator, { processHost, logger });

listeners.get("SIGTERM")?.();
listeners.get("SIGINT")?.();
await coordinator.shutdown();

if (events.filter((event) => event === "server.close").length !== 1) {
  throw new Error("server.close should run once");
}
if (events.filter((event) => event === "runtime.drain").length !== 1) {
  throw new Error("runtime.drain should run once");
}
if (coordinator.snapshot().state !== "stopped") {
  throw new Error("coordinator should be stopped");
}
if (processHost.exitCode !== 0) {
  throw new Error("successful shutdown must not force a non-zero exit code");
}

console.log("process signal adapter test passed", events);
