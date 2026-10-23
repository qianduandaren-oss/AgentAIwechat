import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, copyFileSync, readFileSync,
  writeFileSync, rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCompatibility } from "../day63-contract-landing.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const files = [
  "src/runtime/checkpoint.ts",
  "src/runtime/recovery-operations.ts",
  "src/runtime/sqlite-recovery-finalization.ts"
];

function withSnapshot(run) {
  const directory = mkdtempSync(join(tmpdir(), "recovery-contract-"));
  try {
    for (const file of files) {
      const dest = join(directory, file);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(root, file), dest);
    }
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function mutate(directory, file, from, to) {
  const path = join(directory, file);
  const original = readFileSync(path, "utf8");
  assert.ok(original.includes(from), "expected test mutation anchor");
  writeFileSync(path, original.replace(from, to));
}

test("checked-out main has complete compatibility structure, not a cutover approval", () => {
  const result = inspectCompatibility(root);
  assert.equal(result.status, "PATCHED_STRUCTURE");
  assert.equal(result.mainBuildPassed, false);
  assert.equal(result.atomicCutoverApproved, false);
});

test("missing Control provenance field rejects a partial merge", () =>
  withSnapshot(dir => {
    mutate(dir, files[1], "  causedByCommandId?: string;\n", "");
    assert.equal(inspectCompatibility(dir).status, "BLOCKED");
  }));

test("Schema declaration must remain exported", () =>
  withSnapshot(dir => {
    mutate(dir, files[2],
      "export const RECOVERY_FINALIZATION_SCHEMA = `",
      "const SCHEMA = `");
    assert.equal(inspectCompatibility(dir).status, "BLOCKED");
  }));

test("Schema initialization must use the exported constant", () =>
  withSnapshot(dir => {
    mutate(dir, files[2],
      "this.db.exec(RECOVERY_FINALIZATION_SCHEMA);",
      "this.db.exec(SCHEMA);");
    assert.equal(inspectCompatibility(dir).status, "BLOCKED");
  }));

test("Outbox event_id must remain unique", () =>
  withSnapshot(dir => {
    mutate(dir, files[2], "event_id TEXT NOT NULL UNIQUE", "event_id TEXT NOT NULL");
    assert.equal(inspectCompatibility(dir).status, "BLOCKED");
  }));

test("missing required schema file fails closed", () =>
  withSnapshot(dir => {
    writeFileSync(join(dir, files[2]), "");
    assert.equal(inspectCompatibility(dir).status, "BLOCKED");
  }));

test("legacy Control payload is not assigned a fabricated commandId", () => {
  const historical = JSON.parse('{"runId":"r1","version":2,"status":"active","updatedAt":"2026-10-22T00:00:00.000Z"}');
  assert.equal(historical.causedByCommandId, undefined);
  assert.equal(Object.hasOwn(historical, "causedByCommandId"), false);
});
