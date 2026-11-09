/**
 * Day 80 POSIX DAC LAB ONLY. Never run against a production DB directory.
 * Shell harness creates a disposable /tmp/day80-writer-lab.XXXXXX fixture.
 * 'probe' only opens an existing SQLite file for writing (no SQL writes)
 * and creates/removes a random empty directory canary if permitted.
 */
import { closeSync, openSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Result = "writable" | "denied";
function writeAccess(path: string, mode: "r+" | "wx"): Result {
  let fd: number;
  try {
    fd = openSync(path, mode, 0o600);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ENOENT")
      return "denied";
    throw error; // Unexpected failures must not count as OS denial.
  }
  try { return "writable"; }
  finally {
    closeSync(fd);
    if (mode === "wx") unlinkSync(path);
  }
}
function run(): void {
  const [mode, dir] = process.argv.slice(2);
  const prefix = join(tmpdir(), "day80-writer-lab.");
  if (typeof dir !== "string" ||
      !dir.startsWith(prefix) ||
      !/^[a-zA-Z0-9]{6}$/.test(dir.slice(prefix.length))) {
    throw new Error("unsafe_lab_path: requires a dedicated mktemp fixture under OS tmpdir");
  }
  const dbPath = join(dir, "agent.db");
  if (mode === "seed") {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("CREATE TABLE lab_effect(value INTEGER NOT NULL)");
      db.exec("INSERT INTO lab_effect(value) VALUES(1)");
    } finally { db.close(); }
    console.log("LAB_SEEDED");
    return;
  }
  if (mode !== "probe") throw new Error("unsupported_lab_mode");
  const file = writeAccess(dbPath, "r+");
  const directory = writeAccess(join(dir, ".day80-dir-canary-" + process.pid), "wx");
  if (file === "denied" && directory === "denied")
    console.log("OS_DENIED file=denied directory=denied");
  else
    console.log("UNSAFE_WRITABLE file=" + file + " directory=" + directory);
}
run();
