export interface RunAdmissionControllerOptions {
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
}

export interface RunAdmissionSnapshot {
  activeRuns: number;
  queuedRuns: number;
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
}

export class RunOverloadedError extends Error {
  readonly code = "RUN_OVERLOADED";
  constructor(readonly snapshot: RunAdmissionSnapshot) {
    super(`Agent runtime overloaded: active=${snapshot.activeRuns}/${snapshot.maxConcurrentRuns}, queued=${snapshot.queuedRuns}/${snapshot.maxQueuedRuns}`);
    this.name = "RunOverloadedError";
  }
}

interface Waiter {
  resolve: (release: () => void) => void;
}

export class RunAdmissionController {
  private activeRuns = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly options: RunAdmissionControllerOptions) {
    if (!Number.isInteger(options.maxConcurrentRuns) || options.maxConcurrentRuns <= 0) {
      throw new Error("maxConcurrentRuns must be a positive integer");
    }
    if (!Number.isInteger(options.maxQueuedRuns) || options.maxQueuedRuns < 0) {
      throw new Error("maxQueuedRuns must be a non-negative integer");
    }
  }

  snapshot(): RunAdmissionSnapshot {
    return {
      activeRuns: this.activeRuns,
      queuedRuns: this.queue.length,
      maxConcurrentRuns: this.options.maxConcurrentRuns,
      maxQueuedRuns: this.options.maxQueuedRuns
    };
  }

  async acquire(): Promise<() => void> {
    if (this.activeRuns < this.options.maxConcurrentRuns) {
      this.activeRuns += 1;
      return this.createRelease();
    }

    if (this.queue.length >= this.options.maxQueuedRuns) {
      throw new RunOverloadedError(this.snapshot());
    }

    return new Promise<() => void>(resolve => {
      this.queue.push({ resolve });
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        next.resolve(this.createRelease());
        return;
      }
      this.activeRuns -= 1;
    };
  }
}
