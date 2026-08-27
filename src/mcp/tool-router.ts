import type { CatalogTool, ToolDomain } from "./catalog.js";

export function selectToolDomains(message: string): ToolDomain[] {
  const domains = new Set<ToolDomain>();
  if (/客户|张三|李四|CRM|日志/.test(message)) domains.add("crm");
  if (/提醒|跟进|日程|明天/.test(message)) domains.add("calendar");
  return [...domains];
}

export function selectCandidateTools(
  message: string,
  catalog: CatalogTool[]
): CatalogTool[] {
  const domains = selectToolDomains(message);
  return catalog.filter(tool => domains.includes(tool.server));
}
