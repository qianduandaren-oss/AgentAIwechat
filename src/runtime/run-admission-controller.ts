export interface RunAdmissionControllerOptions {
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
}

export interface RunAcquireOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
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

export class RunQueueTimeoutError extends Error {
  readonly code = "RUN_QUEUE_TIMEOUT";
  constructor(readonly timeoutMs: number) {
    super(`Agent run waited longer than ${timeoutMs}ms for an execution slot`);
    this.name = "RunQueueTimeoutError";
  }
}

export class RunCancelledError extends Error {
  readonly code = "RUN_CANCELLED";
  constructor() {
    super("Agent run was cancelled while waiting for an execution slot");
    this.name = "RunCancelledError";
  }
}

interface Waiter {
  state: "pending" | "admitted" | "timed_out" | "cancelled";
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class RunAdmissionController {
  private activeRuns = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly options: RunAdmissionControllerOptions) {
    if (!Number.isInteger(options.maxConcurrentRuns) || options.maxConcurrentRuns <= 0) throw new Error("maxConcurrentRuns must be a positive integer");
    if (!Number.isInteger(options.maxQueuedRuns) || options.maxQueuedRuns < 0) throw new Error("maxQueuedRuns must be a non-negative integer");
  }

  snapshot(): RunAdmissionSnapshot {
    return { activeRuns: this.activeRuns, queuedRuns: this.queue.length, maxConcurrentRuns: this.options.maxConcurrentRuns, maxQueuedRuns: this.options.maxQueuedRuns };
  }

  async acquire(options: RunAcquireOptions = {}): Promise<() => void> {
    if (options.signal?.aborted) throw new RunCancelledError();
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error("timeoutMs must be a positive number");

    if (this.activeRuns < this.options.maxConcurrentRuns) {
      this.activeRuns += 1;
      return this.createRelease();
    }
    if (this.queue.length >= this.options.maxQueuedRuns) throw new RunOverloadedError(this.snapshot());

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { state: "pending", resolve, reject, signal: options.signal };
      const fail = (state: "timed_out" | "cancelled", error: Error) => {
        if (waiter.state !== "pending") return;
        waiter.state = state;
        this.removeWaiter(waiter);
        this.cleanupWaiter(waiter);
        reject(error);
      };

      if (options.timeoutMs !== undefined) waiter.timer = setTimeout(() => fail("timed_out", new RunQueueTimeoutError(options.timeoutMs!)), options.timeoutMs);
      if (options.signal) {
        waiter.onAbort = () => fail("cancelled", new RunCancelledError());
        options.signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  private removeWaiter(waiter: Waiter): void {
    const index = this.queue.indexOf(waiter);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private cleanupWaiter(waiter: Waiter): void {
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        if (next.state !== "pending") continue;
        next.state = "admitted";
        this.cleanupWaiter(next);
        next.resolve(this.createRelease());
        return;
      }
      this.activeRuns -= 1;
    };
  }
}
