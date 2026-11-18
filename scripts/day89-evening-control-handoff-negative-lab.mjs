#!/usr/bin/env node
/**
 * Day 89 evening: disposable Linux privilege handoff counterexamples.
 * NEVER a deployment attestation or production release gate.
 * Only a sacrificial SQLite snapshot is intentionally damaged by the stale FD.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { constants, chownSync, chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const [mode, dbPath] = process.argv.slice(2);
const SELF = resolve(process.argv[1]);
const CONTROL_UID = 65021;
const WORKER_UID = 65022;
const restrictedEnv = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/tmp', NODE_NO_WARNINGS: '1' };

function writableProbe(path, label) {
  try {
    const fd = openSync(path, constants.O_RDWR);
    closeSync(fd);
    return { label, writable: true };
  } catch (error) {
    if (error?.code !== 'EACCES') throw Error(label + ': expected OS EACCES or successful open, got ' + error?.code);
    return { label, writable: false, errno: 'EACCES' };
  }
}

if (mode === 'legacy-hold') {
  assert.equal(process.getuid(), WORKER_UID);
  const snapshot = join(dirname(dbPath), 'legacy-control-snapshot.sqlite');
  const fd = openSync(snapshot, constants.O_RDWR);
  const selfFdinfo = readFileSync('/proc/self/fdinfo/' + fd, 'utf8');
  const flags = /^flags:\s*([0-7]+)/m.exec(selfFdinfo)?.[1];
  assert.ok(flags && [1, 2].includes(parseInt(flags, 8) & 3), 'legacy open fd not writable');
  console.log(JSON.stringify({ stage: 'legacy_fd_ready', uid: process.getuid(), pid: process.pid, fd, flags }));
  process.stdin.once('data', () => {
    try {
      // Damage a throwaway snapshot only; never modify the live WAL database.
      assert.equal(writeSync(fd, Buffer.from('X'), 0, 1, 0), 1);
      fsyncSync(fd);
      closeSync(fd);
      console.log(JSON.stringify({ stage: 'legacy_fd_still_writable', uid: process.getuid() }));
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });
  process.stdin.resume();
} else if (mode === 'fresh-probe') {
  assert.equal(process.getuid(), WORKER_UID);
  const observations = [
    writableProbe(dbPath, 'db'),
    writableProbe(dbPath + '-wal', 'wal'),
    writableProbe(dbPath + '-shm', 'shm')
  ];
  const marker = join(dirname(dbPath), 'day89-worker-create-' + process.pid);
  try {
    const fd = openSync(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    closeSync(fd);
    unlinkSync(marker);
    observations.push({ label: 'directory-create', writable: true });
  } catch (error) {
    if (error?.code !== 'EACCES') throw Error('directory-create: unexpected errno ' + error?.code);
    observations.push({ label: 'directory-create', writable: false, errno: 'EACCES' });
  }
  console.log(JSON.stringify({ uid: process.getuid(), observations }));
} else if (!mode) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0)
    throw Error('HOLD: requires disposable Linux root CI/VM; do not run on a production host');
  const lab = mkdtempSync(join(tmpdir(), 'agent-day89-evening-'));
  let controller;
  let legacy;
  let controlOut = '';
  let controlErr = '';
  try {
    chmodSync(lab, 0o711);
    const childScript = join(lab, 'day89-evening-lab.mjs');
    copyFileSync(SELF, childScript); // available under /tmp to both unprivileged UIDs
    chmodSync(childScript, 0o644);
    const dir = join(lab, 'control');
    mkdirSync(dir, { mode: 0o700 });
    chownSync(dir, CONTROL_UID, CONTROL_UID);
    chmodSync(dir, 0o711);
    const db = join(dir, 'control.sqlite');
    const snapshot = join(dir, 'legacy-control-snapshot.sqlite');
    const argv = (uid, stage) => ['--reuid=' + uid, '--regid=' + uid, '--clear-groups', process.execPath, childScript, stage, db];
    controller = spawn('setpriv', argv(CONTROL_UID, 'controller'), { env: restrictedEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    controller.stdout.on('data', d => { controlOut += String(d); });
    controller.stderr.on('data', d => { controlErr += String(d); });
    const start = Date.now();
    while (!controlOut.includes('\n') && controller.exitCode === null && Date.now() - start < 10000)
      await new Promise(r => setTimeout(r, 20));
    assert.ok(controlOut.includes('\n'), 'controller not ready: ' + controlErr);
    const ready = JSON.parse(controlOut.slice(0, controlOut.indexOf('\n')));
    assert.equal(ready.uid, CONTROL_UID);
    const files = [db, db + '-wal', db + '-shm'];
    for (const path of files) {
      assert.ok(existsSync(path), 'controller did not create ' + path);
      assert.equal(statSync(path).uid, CONTROL_UID);
    }
    const disposable = new DatabaseSync(snapshot);
    disposable.exec('CREATE TABLE snapshot_probe (id INTEGER PRIMARY KEY); INSERT INTO snapshot_probe VALUES (1);');
    disposable.close();
    chownSync(snapshot, CONTROL_UID, CONTROL_UID);
    chmodSync(snapshot, 0o666); // legacy can open before permission cutover
    legacy = spawn('setpriv', argv(WORKER_UID, 'legacy-hold'), { env: restrictedEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let legacyErr = '';
    legacy.stderr.on('data', d => { legacyErr += String(d); });
    const lines = createInterface({ input: legacy.stdout })[Symbol.asyncIterator]();
    const nextLine = async () => {
      const { value, done } = await Promise.race([
        lines.next(),
        new Promise((_, reject) => setTimeout(() => reject(Error('legacy child timeout: ' + legacyErr)), 10000))
      ]);
      if (done) throw Error('legacy child exited: ' + legacyErr);
      return JSON.parse(value);
    };
    const held = await nextLine();
    assert.equal(held.stage, 'legacy_fd_ready');
    assert.equal(held.uid, WORKER_UID);
    assert.ok([1, 2].includes(parseInt(held.flags, 8) & 3), 'legacy fd reported non-writable');
    chmodSync(snapshot, 0o600);
    for (const path of files) chmodSync(path, 0o600);
    chmodSync(dir, 0o711);
    const probe = () => {
      const child = spawnSync('setpriv', argv(WORKER_UID, 'fresh-probe'), { env: restrictedEnv, encoding: 'utf8', timeout: 10000 });
      if (child.error) throw child.error;
      assert.equal(child.status, 0, 'probe error: ' + child.stdout + child.stderr);
      const data = JSON.parse(child.stdout.trim());
      assert.equal(data.uid, WORKER_UID);
      assert.deepEqual(data.observations.map(x => x.label), ['db', 'wal', 'shm', 'directory-create']);
      return data.observations;
    };
    const deniedBefore = probe();
    assert.ok(deniedBefore.every(x => !x.writable && x.errno === 'EACCES'));
    const exit = new Promise(resolve => legacy.once('exit', resolve));
    legacy.stdin.write('WRITE\n');
    const wrote = await nextLine();
    assert.equal(wrote.stage, 'legacy_fd_still_writable');
    assert.equal(await exit, 0, 'legacy FD write did not finish: ' + legacyErr);
    assert.equal(readFileSync(snapshot)[0], Buffer.from('X')[0]);
    // Model a dangerous rollback that restores Worker open/create permissions.
    for (const path of files) chmodSync(path, 0o666);
    chmodSync(dir, 0o777);
    const writableAfterRollback = probe();
    assert.ok(writableAfterRollback.every(x => x.writable), 'rollback did not reproduce permissions revival');
    chmodSync(dir, 0o711);
    for (const path of files) chmodSync(path, 0o600);
    const deniedAgain = probe();
    assert.ok(deniedAgain.every(x => !x.writable && x.errno === 'EACCES'));
    console.log(JSON.stringify({
      action: 'isolated_unsafe_handoff_counterexamples_observed',
      oldWriterHeldWritableFdAfterLockdown: true,
      newWorkerDeniedAfterLockdown: true,
      rollbackRevivedNewWorkerWrites: true,
      reLockdownDeniedNewOpens: true,
      uidController: CONTROL_UID, uidWorker: WORKER_UID,
      mutated: 'disposable SQLite snapshot only; live WAL connection not modified',
      publishAuthorized: false,
      scope: 'single-host disposable DAC lab, NOT production host/mount namespace/old process inventory'
    }, null, 2));
  } finally {
    if (legacy && legacy.exitCode === null) legacy.kill('SIGKILL');
    if (controller && controller.exitCode === null) {
      controller.stdin.end();
      await Promise.race([
        new Promise(resolve => controller.once('exit', resolve)),
        new Promise(resolve => setTimeout(() => { controller.kill('SIGKILL'); resolve(); }, 3000))
      ]);
    }
    rmSync(lab, { recursive: true, force: true });
  }
} else if (mode === 'controller') {
  assert.equal(process.getuid(), CONTROL_UID);
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode.toLowerCase(), 'wal');
  db.exec('PRAGMA wal_autocheckpoint=0; CREATE TABLE checks (id INTEGER PRIMARY KEY, note TEXT);');
  db.prepare('INSERT INTO checks(note) VALUES (?)').run('control-plane');
  console.log(JSON.stringify({ ready: true, uid: process.getuid(), pid: process.pid }));
  process.stdin.once('end', () => { db.close(); process.exit(0); });
  process.stdin.resume();
} else {
  throw Error('HOLD: invalid lab role');
}
