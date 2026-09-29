export type ToolSideEffect =
  | "none"
  | "internal_write"
  | "external_side_effect";

export type CompensationKind =
  | "none"
  | "automatic"
  | "manual"
  | "unavailable";

export interface ToolEffectPolicy {
  sideEffect: ToolSideEffect;
  retrySafe: boolean;
  requiresIdempotencyKey: boolean;
  compensation: {
    kind: CompensationKind;
    reason?: string;
  };
}

const POLICIES: Record<string, ToolEffectPolicy> = {
  search_customer: {
    sideEffect: "none",
    retrySafe: true,
    requiresIdempotencyKey: false,
    compensation: { kind: "none" }
  },
  search_chat_history: {
    sideEffect: "none",
    retrySafe: true,
    requiresIdempotencyKey: false,
    compensation: { kind: "none" }
  },
  update_customer: {
    sideEffect: "internal_write",
    retrySafe: true,
    requiresIdempotencyKey: true,
    compensation: {
      kind: "automatic",
      reason: "Prefer a compensating update when the previous customer state is known."
    }
  },
  send_message: {
    sideEffect: "external_side_effect",
    retrySafe: false,
    requiresIdempotencyKey: true,
    compensation: {
      kind: "manual",
      reason: "A delivered message cannot be reliably rolled back."
    }
  },
  create_order: {
    sideEffect: "external_side_effect",
    retrySafe: false,
    requiresIdempotencyKey: true,
    compensation: {
      kind: "automatic",
      reason: "Compensate with an explicit order cancellation when the business flow allows it."
    }
  },
  execute_refund: {
    sideEffect: "external_side_effect",
    retrySafe: false,
    requiresIdempotencyKey: true,
    compensation: {
      kind: "manual",
      reason: "A completed refund must not be blindly reversed."
    }
  }
};

const CONSERVATIVE_DEFAULT: ToolEffectPolicy = {
  sideEffect: "external_side_effect",
  retrySafe: false,
  requiresIdempotencyKey: true,
  compensation: {
    kind: "unavailable",
    reason: "Unknown tools default to a conservative side-effect policy."
  }
};

export function getToolEffectPolicy(toolName: string): ToolEffectPolicy {
  return POLICIES[toolName] ?? CONSERVATIVE_DEFAULT;
}

export function registerToolEffectPolicy(
  toolName: string,
  policy: ToolEffectPolicy
): void {
  POLICIES[toolName] = policy;
}
