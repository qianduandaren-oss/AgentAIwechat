import { assertActionAllowed } from "./policy.js";
import type { PlannerAction } from "./types.js";

type UnknownRecord = Record<string, unknown>;

export class PlannerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerValidationError";
  }
}

function asRecord(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerValidationError(`${field} must be an object.`);
  }

  return value as UnknownRecord;
}

function readNonEmptyString(record: UnknownRecord, key: string): string {
  const value = record[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new PlannerValidationError(`${key} must be a non-empty string.`);
  }

  return value;
}

export function parsePlannerAction(value: unknown): PlannerAction {
  const candidate = asRecord(value, "Planner action");
  const type = readNonEmptyString(candidate, "type");
  const input = asRecord(candidate.input, "Planner action input");

  let action: PlannerAction;

  switch (type) {
    case "search_customer":
      action = {
        type,
        input: {
          name: readNonEmptyString(input, "name")
        }
      };
      break;

    case "search_chat_history":
      action = {
        type,
        input: {
          customerId: readNonEmptyString(input, "customerId")
        }
      };
      break;

    case "search_knowledge":
      action = {
        type,
        input: {
          query: readNonEmptyString(input, "query")
        }
      };
      break;

    case "finish":
      action = {
        type,
        input: {
          answer: readNonEmptyString(input, "answer")
        }
      };
      break;

    default:
      throw new PlannerValidationError(
        `Unsupported planner action type: ${type}`
      );
  }

  try {
    assertActionAllowed(action);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PlannerValidationError(message);
  }

  return action;
}
