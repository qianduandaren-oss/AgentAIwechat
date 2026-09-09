export type SensitiveDataType = "secret" | "pii" | "business_sensitive";

export interface SensitiveValue {
  type: SensitiveDataType;
  value: string;
}

export interface RedactionRule {
  type: SensitiveDataType;
  replacement: string;
}

const defaultRules: Record<SensitiveDataType, RedactionRule> = {
  secret: { type: "secret", replacement: "[REDACTED_SECRET]" },
  pii: { type: "pii", replacement: "[REDACTED_PII]" },
  business_sensitive: { type: "business_sensitive", replacement: "[REDACTED_BUSINESS_DATA]" }
};

export function redactSensitiveValue(input: SensitiveValue): string {
  return defaultRules[input.type].replacement;
}

export function maskPhone(phone: string): string {
  if (!/^\d{11}$/.test(phone)) return "[REDACTED_PII]";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

const secretKeys = new Set([
  "authorization",
  "apiKey",
  "api_key",
  "token",
  "accessToken",
  "access_token",
  "password",
  "secret"
]);

const piiKeys = new Set([
  "idCard",
  "id_card",
  "identityNumber",
  "email",
  "address"
]);

export function sanitizeForLog(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(item => sanitizeForLog(item));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      secretKeys.has(key) ? "[REDACTED_SECRET]" : sanitizeForLog(item)
    ])
  );
}

export function sanitizeForLLM(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(item => sanitizeForLLM(item));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (secretKeys.has(key)) return [key, "[REDACTED_SECRET]"];
      if (piiKeys.has(key)) return [key, "[REDACTED_PII]"];
      if (key === "phone" && typeof item === "string") return [key, maskPhone(item)];
      return [key, sanitizeForLLM(item)];
    })
  );
}
