export function selectToolDomains(message) {
    const domains = new Set();
    if (/客户|张三|李四|CRM|日志/.test(message))
        domains.add("crm");
    if (/提醒|跟进|日程|明天/.test(message))
        domains.add("calendar");
    return [...domains];
}
export function selectCandidateTools(message, catalog) {
    const domains = selectToolDomains(message);
    return catalog.filter(tool => domains.includes(tool.server));
}
