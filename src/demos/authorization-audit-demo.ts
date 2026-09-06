import { authorize } from "../security/authorization-service.js";
import type { Actor, Resource } from "../security/authorization-types.js";
import { createAuditEvent, InMemoryAuditSink } from "../security/audit-log.js";

const audit = new InMemoryAuditSink();

const actors: Record<string, Actor> = {
  sales: {
    id: "user_bj_01",
    roles: ["sales"],
    departmentId: "beijing_team_1",
    regionId: "north"
  },
  regionalManager: {
    id: "manager_north_01",
    roles: ["regional_manager"],
    departmentId: "beijing_team_1",
    regionId: "north"
  }
};

const resources: Record<string, Resource> = {
  beijing: {
    id: "customer_bj_001",
    type: "customer",
    departmentId: "beijing_team_1",
    regionId: "north"
  },
  shanghai: {
    id: "customer_sh_001",
    type: "customer",
    departmentId: "shanghai_team_1",
    regionId: "east"
  },
  tianjin: {
    id: "customer_tj_001",
    type: "customer",
    departmentId: "tianjin_team_1",
    regionId: "north"
  }
};

async function runCase(name: string, actor: Actor, resource: Resource) {
  const request = {
    actor,
    agentId: "sales_agent",
    action: "customer.read",
    resource
  };

  const decision = authorize(request);

  await audit.write(createAuditEvent({
    actorId: actor.id,
    agentId: request.agentId,
    action: request.action,
    resourceId: resource.id,
    resourceType: resource.type,
    outcome: decision.allowed ? "allowed" : "denied",
    reason: decision.reason,
    policy: decision.policy,
    traceId: `trace_${name}`
  }));

  console.log(`${name}: ${decision.allowed ? "ALLOW" : "DENY"} (${decision.reason})`);
}

await runCase("same_department", actors.sales, resources.beijing);
await runCase("cross_department", actors.sales, resources.shanghai);
await runCase("regional_manager", actors.regionalManager, resources.tianjin);

console.log("\nAudit Trail");
console.table(await audit.list());
