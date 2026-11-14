/**
 * Day 85 evening: disposable Linux POSIX DAC / WAL / SHM and rollback
 * counterexample. NEVER point this at a production path.
 * Uses a genuine distinct nobody UID and sudo -n, fails closed if unsupported.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const prefix = join(tmpdir(), 'day85-evening-wal.');
const mode = process.argv[2], fixture = process.argv[3];

function probe(path) {
  try {
    const fd = openSync(path, 'r+');
    closeSync(fd);
    return 'writable';
  } catch (error) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) return 'denied';
    throw error; // ENOENT and other setup errors are NOT a successful denial.
  }
}
function summarize(dir) {
  const files = ['agent.sqlite', 'agent.sqlite-wal', 'agent.sqlite-shm'];
  const results = files.map(name => probe(join(dir, name)));
  const canary = join(dir, '.canary-' + process.pid);
  let directory;
  try {
    const fd = openSync(canary, 'wx', 0o600);
    closeSync(fd);
    // Only the disposable fixture directory is permitted here.
    rmSync(canary);
    directory = 'writable';
  } catch (error) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) directory = 'denied';
    else throw error;
  }
  return ['db', 'wal', 'shm', 'directory'].map((name, index) =>
    name + '=' + (index < 3 ? results[index] : directory)).join(' ');
}

if (mode === 'probe') {
  if (!fixture?.startsWith(prefix) ||
      !/^[A-Za-z0-9]{6}$/.test(fixture.slice(prefix.length))) {
    throw new Error('FAIL_CLOSED: probe must use disposable mkdtemp fixture');
  }
  console.log(summarize(fixture));
} else if (!mode) {
  if (process.platform !== 'linux') throw Error('FAIL_CLOSED: Linux required');
  const sudo = spawnSync('sudo', ['-n', '-u', 'nobody', '--', 'id', '-u'], {encoding:'utf8', timeout: 10000});
  if (sudo.status !== 0 || !/^[0-9]+$/.test(sudo.stdout.trim()) || sudo.stdout.trim() === '0') {
    throw Error('FAIL_CLOSED: dedicated unprivileged identity unavailable');
  }
  const dir = mkdtempSync(prefix);
  const codeDir = mkdtempSync(join(tmpdir(), 'day85-evening-wal-code.'));
  let database;
  try {
    const copy = join(codeDir, 'probe.mjs');
    chmodSync(codeDir, 0o755);
    copyFileSync(fileURLToPath(import.meta.url), copy);
    chmodSync(copy, 0o644);
    const dbPath = join(dir, 'agent.sqlite');
    database = new DatabaseSync(dbPath);
    const pragma = database.prepare('PRAGMA journal_mode=WAL').get();
    assert.equal(String(pragma.journal_mode).toLowerCase(), 'wal');
    database.exec('PRAGMA wal_autocheckpoint=0');
    database.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    database.exec("INSERT INTO evidence(value) VALUES ('trusted')");
    const paths = [dbPath, dbPath + '-wal', dbPath + '-shm'];
    for (const path of paths) assert.ok(existsSync(path), 'SQLite WAL/SHM file missing: ' + path);

    const asLegacy = () => {
      const run = spawnSync('sudo', ['-n', '-u', 'nobody', '--',
        process.execPath, copy, 'probe', dir], {encoding: 'utf8', timeout: 10000});
      if (run.status !== 0) throw Error('FAIL_CLOSED: legacy probe failed: ' + run.stderr);
      return run.stdout.trim();
    };
    const allowed = 'db=writable wal=writable shm=writable directory=writable';
    const denied = 'db=denied wal=denied shm=denied directory=denied';

    // Unsafe legacy identity: writable before handoff (positive control).
    chmodSync(dir, 0o777);
    for (const path of paths) chmodSync(path, 0o666);
    assert.equal(asLegacy(), allowed);

    // Isolated writer owns database directory, DB, WAL and SHM.
    for (const path of paths) chmodSync(path, 0o600);
    chmodSync(dir, 0o700);
    assert.equal(asLegacy(), denied);

    // Deliberate rollback counterexample: restoring permissions resurrects
    // a fresh legacy writer. This MUST remain a release blocker.
    chmodSync(dir, 0o777);
    for (const path of paths) chmodSync(path, 0o666);
    assert.equal(asLegacy(), allowed);
    for (const path of paths) chmodSync(path, 0o600);
    chmodSync(dir, 0o700);
    assert.equal(asLegacy(), denied);
    const row = database.prepare('SELECT value FROM evidence WHERE id=1').get();
    assert.equal(row.value, 'trusted');
    console.log('PASS Day 85 evening disposable WAL/SHM DAC: genuine legacy UID denied after isolation; rollback reopens writes.');
    console.log('LIMIT: Day 80 separately proves already-open writable FD bypass. No production mount, containers, WAL recovery, real ACK or deployment rollback attestation. NO_GO.');
  } finally {
    try { database?.close(); } finally {
      rmSync(dir, {recursive: true, force: true});
      rmSync(codeDir, {recursive: true, force: true});
    }
  }
} else {
  throw Error('FAIL_CLOSED: invalid mode');
}
