import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const files = {
  checkpoint: "src/runtime/checkpoint.ts",
  control: "src/runtime/recovery-operations.ts",
  sqlite: "src/runtime/sqlite-recovery-finalization.ts"
};
const once = (source, value) => source.split(value).length === 2;

export function inspectCompatibility(root) {
  const source = {};
  for (const [key, path] of Object.entries(files)) {
    try { source[key] = readFileSync(join(root, path), "utf8"); }
    catch { return { status: "BLOCKED", reason: `missing ${path}`, mainBuildPassed: false }; }
  }
  const block = (text, name) => text.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  const checkpoint = block(source.checkpoint, "AgentRunCheckpoint");
  const control = block(source.control, "RecoveryControlState");
  if (!checkpoint || !control) return { status: "BLOCKED", reason: "interface missing", mainBuildPassed: false };
  const ck = once(checkpoint, "causedByCommandId?: string;");
  const ctl = once(control, "causedByCommandId?: string;");
  const sql = source.sqlite;
  const old = once(sql, "const SCHEMA = `") && once(sql, "this.db.exec(SCHEMA);");
  const updated = once(sql, "export const RECOVERY_FINALIZATION_SCHEMA = `")
    && once(sql, "this.db.exec(RECOVERY_FINALIZATION_SCHEMA);")
    && !sql.includes("this.db.exec(SCHEMA);");
  const tables = ["recovery_controls", "recovery_commands", "recovery_outbox"]
    .every(t => sql.includes(`CREATE TABLE IF NOT EXISTS ${t}`));
  const unique = /event_id\\s+TEXT\\s+NOT\\s+NULL\\s+UNIQUE/.test(sql);
  const status = !ck || !tables || !unique ? "BLOCKED"
    : ctl && updated && !old ? "PATCHED_STRUCTURE"
    : !control.includes("causedByCommandId") && old && !updated ? "READY_TO_PATCH"
    : "BLOCKED";
  return { status, mainBuildPassed: false, atomicCutoverApproved: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectCompatibility(resolve(process.argv[2] ?? "."));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "BLOCKED") process.exitCode = 2;
}
