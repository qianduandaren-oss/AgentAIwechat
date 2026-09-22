export interface ServerHost {
  close(): Promise<void>;
}

export interface DrainableRuntime {
  drain(): Promise<void>;
}

export interface ShutdownSnapshot {
  state: "idle" | "shutting_down" | "stopped";
}

/** Coordinates host shutdown without owning process signals. */
export class ShutdownCoordinator {
  private state: ShutdownSnapshot["state"] = "idle";
  private shutdownPromise?: Promise<void>;

  constructor(
    private readonly server: ServerHost,
    private readonly runtime: DrainableRuntime,
  ) {}

  snapshot(): ShutdownSnapshot {
    return { state: this.state };
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.state = "shutting_down";
    this.shutdownPromise = this.doShutdown();
    return this.shutdownPromise;
  }

  private async doShutdown(): Promise<void> {
    // Stop the network entry first, then drain work already accepted by runtime.
    await this.server.close();
    await this.runtime.drain();
    this.state = "stopped";
  }
}
