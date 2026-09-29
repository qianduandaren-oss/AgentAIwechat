import type { ToolSideEffect } from "../security/tool-effect-policy.js";
import type { ToolExecutionOutcome } from "./checkpoint.js";

export type RecoveryAction =
  | "skip"
  | "retry"
  | "reconcile"
  | "suspend";

export interface RecoveryContext {
  outcome: ToolExecutionOutcome;
  sideEffect: ToolSideEffect;
  retrySafe: boolean;
  hasIdempotencyKey: boolean;
  canReconcile: boolean;
}

export interface RecoveryPlan {
  action: RecoveryAction;
  reason: string;
}

export function planRecovery(ctx: RecoveryContext): RecoveryPlan {
  if (ctx.outcome === "executed") {
    return { action: "skip", reason: "tool_already_executed" };
  }

  if (
    ctx.outcome === "never_executed" ||
    ctx.outcome === "cancelled_before_execution"
  ) {
    return ctx.retrySafe
      ? { action: "retry", reason: "tool_confirmed_not_executed_and_retry_safe" }
      : { action: "suspend", reason: "tool_not_executed_but_retry_not_safe" };
  }

  if (ctx.outcome === "started" || ctx.outcome === "unknown") {
    if (ctx.sideEffect === "none" && ctx.retrySafe) {
      return { action: "retry", reason: "side_effect_free_uncertain_execution" };
    }

    if (ctx.canReconcile && ctx.hasIdempotencyKey) {
      return {
        action: "reconcile",
        reason: "side_effect_with_uncertain_outcome"
      };
    }

    return {
      action: "suspend",
      reason: "uncertain_side_effect_without_safe_reconciliation"
    };
  }

  if (ctx.outcome === "failed") {
    return ctx.retrySafe
      ? { action: "retry", reason: "confirmed_failure_and_retry_safe" }
      : { action: "suspend", reason: "confirmed_failure_but_retry_not_safe" };
  }

  return { action: "suspend", reason: "unhandled_recovery_state" };
}
