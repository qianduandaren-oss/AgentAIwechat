export type ReconciliationOutcome =
  | "executed"
  | "never_executed"
  | "unknown";

export interface ReconcileInput {
  toolName: string;
  idempotencyKey: string;
}

export interface ToolReconciler {
  reconcile(input: ReconcileInput): Promise<ReconciliationOutcome>;
}

export class ReconcilerRegistry {
  private readonly reconcilers = new Map<string, ToolReconciler>();

  register(toolName: string, reconciler: ToolReconciler): void {
    this.reconcilers.set(toolName, reconciler);
  }

  get(toolName: string): ToolReconciler | undefined {
    return this.reconcilers.get(toolName);
  }

  canReconcile(toolName: string): boolean {
    return this.reconcilers.has(toolName);
  }
}
