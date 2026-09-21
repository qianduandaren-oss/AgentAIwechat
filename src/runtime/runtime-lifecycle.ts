export type RuntimeLifecycleState = "RUNNING" | "DRAINING" | "STOPPED";

export class RuntimeDrainingError extends Error {
  readonly code = "RUN_DRAINING";
  constructor() {
    super("Agent runtime is draining and no longer accepts new runs");
    this.name = "RuntimeDrainingError";
  }
}

export class RuntimeLifecycle {
  private state: RuntimeLifecycleState = "RUNNING";
  private activeRuns = 0;
  private readonly drainWaiters: Array<() => void> = [];

  snapshot() {
    return { state: this.state, activeRuns: this.activeRuns } as const;
  }

  enterRun(): () => void {
    if (this.state !== "RUNNING") throw new RuntimeDrainingError();
    this.activeRuns += 1;
    let left = false;
    return () => {
      if (left) return;
      left = true;
      this.activeRuns -= 1;
      this.finishDrainIfPossible();
    };
  }

  beginDrain(): void {
    if (this.state === "STOPPED") return;
    this.state = "DRAINING";
    this.finishDrainIfPossible();
  }

  async waitForDrain(): Promise<void> {
    this.beginDrain();
    if (this.state === "STOPPED") return;
    await new Promise<void>(resolve => this.drainWaiters.push(resolve));
  }

  private finishDrainIfPossible(): void {
    if (this.state !== "DRAINING" || this.activeRuns !== 0) return;
    this.state = "STOPPED";
    while (this.drainWaiters.length > 0) this.drainWaiters.shift()!();
  }
}
