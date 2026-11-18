#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
const root = resolve(process.argv[2] ?? ".");
const storePath = "src/runtime/recovery-writer-collector-challenge-store.ts";
const servicePath = "src/runtime/recovery-writer-collector-control-plane-service.ts";
const legacy = ["provisionLabTrustedKey", "issueChallenge", "revokeTrustedKey"];
function tsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tsFiles(p) : e.isFile() && p.endsWith(".ts") ? [p] : [];
  });
}
function get(path) { return readFileSync(join(root, path), "utf8"); }
const store = get(storePath);
const service = get(servicePath);
for (const method of legacy) {
  if (!store.includes(method + "(")) throw Error("legacy_method_missing:" + method);
}
if (!service.includes("this.store.executeAuditedControlCommand("))
  throw Error("reviewed_service_not_routed_to_audited_store");
const runtimeDirect = [];
const labDirect = [];
for (const abs of tsFiles(join(root, "src"))) {
  const path = relative(root, abs).replaceAll("\\", "/");
  for (const [i, line] of get(path).split(/\r?\n/).entries()) {
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    for (const method of legacy) {
      if (line.includes("." + method + "(")) {
        const hit = path + ":" + (i + 1) + ":" + method;
        (path.startsWith("src/runtime/") ? runtimeDirect : labDirect).push(hit);
      }
    }
  }
}
console.log("Day 89 legacy admin API remains public:", legacy.join(", "));
console.log("Lab/demo explicit legacy calls:", labDirect.length);
labDirect.forEach(x => console.log("  LAB:", x));
if (runtimeDirect.length) {
  runtimeDirect.forEach(x => console.error("NEW_RUNTIME_BYPASS:", x));
  throw Error("direct_legacy_admin_call_in_runtime");
}
console.log("PASS: no explicit legacy direct admin calls in src/runtime");
console.log("NO_GO: public APIs, SQL, old FDs and rollback mounts are NOT isolated.");
console.log("A static scan cannot detect aliases, computed calls or direct SQL.");
