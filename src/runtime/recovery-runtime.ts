import {
  getToolEffectPolicy,
  type ToolEffectPolicy
} from "../security/tool-effect-policy.js";
import type { ToolExecutionRecord } from "./checkpoint.js";
import {
  planRecovery,
  type RecoveryPlan
} from "./recovery-planner.js";
import {
  ReconcilerRegistry,
  type ReconciliationOutcome
} from "./reconciler.js";

export interface RecoveryResolution {
  plan: RecoveryPlan;
  reconciliationOutcome?: ReconciliationOutcome;
  resolvedOutcome?: ToolExecutionRecord["outcome"];
  nextPlan?: RecoveryPlan;
}

export type RecoveryPolicyResolver = (
  toolName: string
) => ToolEffectPolicy;

export interface RecoveryRuntimeHooks {
  onPlanDecided?(
    plan: RecoveryPlan,
    record: ToolExecutionRecord
  ): Promise<void> | void;

  onReconciliationStarted?(
    record: ToolExecutionRecord
  ): Promise<void> | void;

  onReconciliationCompleted?(
    outcome: ReconciliationOutcome,
    record: ToolExecutionRecord
  ): Promise<void> | void;
}

function buildPlan(
  record: ToolExecutionRecord,
  policy: ToolEffectPolicy,
  registry: ReconcilerRegistry
): RecoveryPlan {
  return planRecovery({
    outcome: record.outcome,
    sideEffect: record.sideEffect ?? policy.sideEffect,
    retrySafe: record.retrySafe ?? policy.retrySafe,
    hasIdempotencyKey: Boolean(record.idempotencyKey),
    canReconcile: registry.canReconcile(record.toolName)
  });
}

export async function recoverToolExecution(
  record: ToolExecutionRecord,
  registry: ReconcilerRegistry,
  policyResolver: RecoveryPolicyResolver = getToolEffectPolicy,
  hooks: RecoveryRuntimeHooks = {}
): Promise<RecoveryResolution> {
  const policy = policyResolver(record.toolName);
  const plan = buildPlan(record, policy, registry);

  await hooks.onPlanDecided?.(plan, record);

  if (plan.action !== "reconcile") {
    return { plan };
  }

  const reconciler = registry.get(record.toolName);
  if (!reconciler || !record.idempotencyKey) {
    return {
      plan: {
        action: "suspend",
        reason: "reconciliation_requested_but_not_available"
      }
    };
  }

  await hooks.onReconciliationStarted?.(record);

  const reconciliationOutcome = await reconciler.reconcile({
    toolName: record.toolName,
    idempotencyKey: record.idempotencyKey
  });

  await hooks.onReconciliationCompleted?.(
    reconciliationOutcome,
    record
  );

  if (reconciliationOutcome === "executed") {
    return {
      plan,
      reconciliationOutcome,
      resolvedOutcome: "executed",
      nextPlan: {
        action: "skip",
        reason: "reconciliation_confirmed_executed"
      }
    };
  }

  if (reconciliationOutcome === "never_executed") {
    const nextPlan = planRecovery({
      outcome: "never_executed",
      sideEffect: record.sideEffect ?? policy.sideEffect,
      retrySafe: record.retrySafe ?? policy.retrySafe,
      hasIdempotencyKey: Boolean(record.idempotencyKey),
      canReconcile: true
    });

    return {
      plan,
      reconciliationOutcome,
      resolvedOutcome: "never_executed",
      nextPlan
    };
  }

  return {
    plan,
    reconciliationOutcome,
    resolvedOutcome: "unknown",
    nextPlan: {
      action: "suspend",
      reason: "reconciliation_still_unknown"
    }
  };
}
