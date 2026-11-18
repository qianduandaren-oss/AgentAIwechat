#!/usr/bin/env node
/**
 * Day 89 noon — single-host Linux DAC experiment, not a production attestation.
 * Run only in disposable CI/VM as root. Two real, distinct numeric test UIDs.
 * All SQLite/WAL/SHM files live under a uniquely named /tmp directory.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { constants, chownSync, chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [mode, arg] = process.argv.slice(2);
const CONTROL_UID = 65021;
const WORKER_UID = 65022;
const SELF = resolve(process.argv[1]);
const restrictedEnv = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/tmp', NODE_NO_WARNINGS: '1' };

if (mode === 'control-child') {
  assert.equal(process.getuid(), CONTROL_UID, 'control identity mismatch');
  const db = new DatabaseSync(arg);
  assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode.toLowerCase(), 'wal');
  db.exec('PRAGMA wal_autocheckpoint=0; CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY, note TEXT NOT NULL);');
  db.prepare('INSERT INTO checks(note) VALUES (?)').run('control-plane-owned');
  process.stdout.write(JSON.stringify({ ready: true, uid: process.getuid(), pid: process.pid }) + '\n');
  process.stdin.resume();
  process.stdin.on('end', () => { db.close(); process.exit(0); });
} else if (mode === 'worker-child') {
  assert.equal(process.getuid(), WORKER_UID, 'worker identity mismatch');
  const files = [arg, arg + '-wal', arg + '-shm'];
  const observations = [];
  for (const file of files) {
    try {
      const fd = openSync(file, constants.O_RDWR);
      closeSync(fd);
      observations.push({ file: file.slice(arg.length) || 'db', denied: false });
    } catch (error) {
      observations.push({ file: file.slice(arg.length) || 'db', denied: error?.code === 'EACCES', error: error?.code });
    }
  }
  try {
    const fd = openSync(join(resolve(arg, '..'), 'worker-cannot-create'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    closeSync(fd);
    observations.push({ file: 'directory-create', denied: false });
  } catch (error) {
    observations.push({ file: 'directory-create', denied: error?.code === 'EACCES', error: error?.code });
  }
  process.stdout.write(JSON.stringify({ uid: process.getuid(), observations }) + '\n');
  if (observations.some(item => !item.denied)) process.exitCode = 1;
} else if (!mode) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0)
    throw Error('HOLD: requires disposable Linux root CI/VM; never a production host');

  const lab = mkdtempSync(join(tmpdir(), 'agent-day89-os-'));
  chmodSync(lab, 0o711); // traversal only for child UIDs
  const dir = join(lab, 'control');
  const dbPath = join(dir, 'control.sqlite');
  let controller;
  try {
    mkdirSync(dir, { mode: 0o700 });
    chownSync(dir, CONTROL_UID, CONTROL_UID);
    chmodSync(dir, 0o711); // controller can create WAL/SHM, worker cannot
    const flags = ['--reuid=' + CONTROL_UID, '--regid=' + CONTROL_UID, '--clear-groups', process.execPath, SELF, 'control-child', dbPath];
    controller = spawn('setpriv', flags, { stdio: ['pipe', 'pipe', 'pipe'], env: restrictedEnv });
    let stderr = '';
    controller.stderr.on('data', data => { stderr += String(data); });
    const started = await new Promise((ok, fail) => {
      let stdout = '';
      const timeout = setTimeout(() => fail(Error('control start timed out: ' + stderr)), 10000);
      const cleanup = () => clearTimeout(timeout);
      controller.on('error', e => { cleanup(); fail(e); });
      controller.on('exit', code => { cleanup(); fail(Error('control exited early: ' + code + ' ' + stderr)); });
      controller.stdout.on('data', chunk => {
        stdout += String(chunk);
        const i = stdout.indexOf('\n');
        if (i >= 0) {
          cleanup();
          try { ok(JSON.parse(stdout.slice(0, i))); } catch (error) { fail(error); }
        }
      });
    });
    assert.equal(started.uid, CONTROL_UID);
    const names = [dbPath, dbPath + '-wal', dbPath + '-shm'];
    for (const file of names) {
      assert.ok(existsSync(file), 'controller did not create ' + file);
      assert.equal(statSync(file).uid, CONTROL_UID, 'file owner mismatch');
      assert.equal(statSync(file).mode & 0o022, 0, 'group/other writable file');
    }
    const args = ['--reuid=' + WORKER_UID, '--regid=' + WORKER_UID, '--clear-groups', process.execPath, SELF, 'worker-child', dbPath];
    const worker = spawnSync('setpriv', args, { encoding: 'utf8', env: restrictedEnv, timeout: 10000 });
    if (worker.error) throw worker.error;
    assert.equal(worker.status, 0, 'worker obtained write access or failed: ' + worker.stdout + worker.stderr);
    const report = JSON.parse(worker.stdout.trim());
    assert.equal(report.uid, WORKER_UID);
    assert.equal(report.observations.length, 4);
    assert.ok(report.observations.every(item => item.denied), 'worker obtained writable access');
    console.log(JSON.stringify({
      action: 'isolated_os_permissions_observed',
      controllerUid: CONTROL_UID, workerUid: WORKER_UID,
      controlProcessPid: started.pid,
      dbWalShmOwnedByController: true,
      denied: report.observations.map(item => item.file),
      publishAuthorized: false,
      scope: 'single-host /tmp Linux DAC only; new open attempts. Old FDs, mounts and rollback NOT proven'
    }, null, 2));
  } finally {
    if (controller && controller.exitCode === null) {
      controller.stdin.end();
      await Promise.race([
        new Promise(resolve => controller.once('exit', resolve)),
        new Promise(resolve => setTimeout(() => { controller.kill('SIGKILL'); resolve(); }, 3000))
      ]);
    }
    rmSync(lab, { recursive: true, force: true });
  }
} else {
  throw Error('unknown mode: ' + mode);
}
