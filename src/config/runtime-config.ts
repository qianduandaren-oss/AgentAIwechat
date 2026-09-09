export type RuntimeEnvironment = "development" | "test" | "production";

export interface RuntimeConfig {
  environment: RuntimeEnvironment;
  llm: {
    provider: string;
    model: string;
    timeoutMs: number;
    maxRetries: number;
  };
}

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number
): number {
  const raw = env[key];
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): RuntimeConfig {
  const environment = (env.NODE_ENV ?? "development") as RuntimeEnvironment;
  if (!["development", "test", "production"].includes(environment)) {
    throw new Error(`Unsupported NODE_ENV: ${environment}`);
  }

  return {
    environment,
    llm: {
      provider: env.LLM_PROVIDER ?? "mock",
      model: env.LLM_MODEL ?? "mock-model",
      timeoutMs: readPositiveInt(env, "LLM_TIMEOUT_MS", 15_000),
      maxRetries: readPositiveInt(env, "LLM_MAX_RETRIES", 2)
    }
  };
}
