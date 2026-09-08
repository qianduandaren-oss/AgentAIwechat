import { maskPhone, sanitizeForLog } from "./sensitive-data.js";

export interface CustomerToolResult {
  id: string;
  name: string;
  phone?: string;
  idCard?: string;
  intentCourse?: string;
  recentSummary?: string;
  ownerId?: string;
  accessToken?: string;
}

export interface SafeCustomerContext {
  customerId: string;
  name?: string;
  phone?: string;
  intentCourse?: string;
  recentSummary?: string;
}

export interface SafeToolResultPipelineOutput {
  llmContext: SafeCustomerContext;
  logPayload: unknown;
}

export function projectCustomerForLLM(
  customer: CustomerToolResult,
  options: { includeName?: boolean; includeMaskedPhone?: boolean } = {}
): SafeCustomerContext {
  return {
    customerId: customer.id,
    ...(options.includeName ? { name: customer.name } : {}),
    ...(options.includeMaskedPhone && customer.phone ? { phone: maskPhone(customer.phone) } : {}),
    ...(customer.intentCourse ? { intentCourse: customer.intentCourse } : {}),
    ...(customer.recentSummary ? { recentSummary: customer.recentSummary } : {})
  };
}

export function buildSafeToolResult(
  customer: CustomerToolResult,
  options: { includeName?: boolean; includeMaskedPhone?: boolean } = {}
): SafeToolResultPipelineOutput {
  return {
    llmContext: projectCustomerForLLM(customer, options),
    logPayload: sanitizeForLog(customer)
  };
}
