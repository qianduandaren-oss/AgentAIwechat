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
  policyResolver: RecoveryPolicyResolver = getToolEffectPolicy
): Promise<RecoveryResolution> {
  const policy = policyResolver(record.toolName);
  const plan = buildPlan(record, policy, registry);

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

  const reconciliationOutcome = await reconciler.reconcile({
    toolName: record.toolName,
    idempotencyKey: record.idempotencyKey
  });

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
