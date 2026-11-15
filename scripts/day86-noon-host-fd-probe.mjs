/**
 * Day 86 noon: disposable Linux /proc FD evidence lab.
 * Spawn only our own child with a /tmp SQLite fixture.
 * Not a production observer or a publish authorization.
 */
import { strict as assert } from 'node:assert';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { WRITER_RELEASE_CHECKS, reviewWriterReleaseEvidence } from '../dist/runtime/recovery-writer-release-evidence.js';

const prefix = join(tmpdir(), 'day86-noon-fd-');
const mode = process.argv[2];
const fixture = process.argv[3];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function startTicks(pid) {
  const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
  // /proc/<pid>/stat: field 22 is starttime; split after the final ') '.
  return stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/)[19];
}
function writableFixtureFds(pid, dir) {
  const base = '/proc/' + pid + '/fd';
  const result = [];
  for (const fd of readdirSync(base)) {
    let target;
    try { target = readlinkSync(base + '/' + fd); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const clean = target.replace(/ \(deleted\)$/, '');
    if (!(clean === dir || clean.startsWith(dir + '/'))) continue;
    const meta = readFileSync('/proc/' + pid + '/fdinfo/' + fd, 'utf8');
    const flags = /^flags:\s*([0-7]+)/m.exec(meta)?.[1];
    if (!flags) throw Error('FAIL_CLOSED: kernel fd flags missing');
    const access = parseInt(flags, 8) & 3; // O_ACCMODE: 1=write, 2=read-write
    if (access === 1 || access === 2) {
      result.push({ fd: Number(fd), file: clean.slice(dir.length), access });
    }
  }
  return result.sort((a, b) => a.fd - b.fd);
}
function review(phase, pid, ticks, fds, statuses) {
  const now = Date.now();
  const raw = { phase, pid, ticks, fds, collector: 'unprivileged parent /proc test' };
  const evidence = {
    deploymentId: 'staging:day86',
    releaseId: 'release-test-86-noon',
    observerId: 'parent-process-procfs-fixture',
    observerKind: 'independent_host_probe', // unverified text, NOT attested
    observedAtEpochMs: now,
    observations: WRITER_RELEASE_CHECKS.map(check => ({
      check, status: statuses[check] ?? 'unknown',
      artifactSha256: digest({ raw, check, status: statuses[check] ?? 'unknown' })
    }))
  };
  return reviewWriterReleaseEvidence({
    intent: 'isolated_review',
    deploymentId: evidence.deploymentId,
    releaseId: evidence.releaseId,
    nowEpochMs: now,
    evidence
  });
}

if (mode === 'legacy-child') {
  if (process.platform !== 'linux' || !fixture?.startsWith(prefix) ||
      !/^[A-Za-z0-9]{6}$/.test(fixture.slice(prefix.length))) {
    throw Error('FAIL_CLOSED: owned temporary Linux fixture required');
  }
  const db = new DatabaseSync(join(fixture, 'agent.sqlite'));
  const journal = db.prepare('PRAGMA journal_mode=WAL').get();
  assert.equal(String(journal.journal_mode).toLowerCase(), 'wal');
  db.exec("PRAGMA wal_autocheckpoint=0; CREATE TABLE holder (v TEXT); INSERT INTO holder VALUES ('held')");
  for (const file of ['agent.sqlite', 'agent.sqlite-wal', 'agent.sqlite-shm']) {
    assert.ok(existsSync(join(fixture, file)), 'missing WAL fixture component: ' + file);
  }
  process.send?.({ kind: 'ready' });
  process.on('message', message => {
    if (message === 'stop') { db.close(); process.exit(0); }
  });
} else if (!mode) {
  if (process.platform !== 'linux' || !existsSync('/proc/self/fd')) {
    throw Error('FAIL_CLOSED: Linux procfs required');
  }
  const dir = mkdtempSync(prefix);
  const child = fork(fileURLToPath(import.meta.url), ['legacy-child', dir], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('legacy child startup timeout ' + stderr)), 10000);
      child.once('message', message => {
        clearTimeout(timer);
        message?.kind === 'ready' ? resolve() : reject(Error('invalid legacy child readiness'));
      });
      child.once('exit', code => { clearTimeout(timer); reject(Error('legacy child exited early: ' + code + stderr)); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const pid = child.pid;
    const ticks = startTicks(pid);
    const live = writableFixtureFds(pid, dir);
    assert.ok(live.some(fd => fd.file === '/agent.sqlite'), 'kernel must show writable SQLite FD');
    assert.deepEqual(review('before', pid, ticks, live, {
      legacy_processes_exited: 'fail', legacy_writable_fds_drained: 'fail'
    }), { action: 'hold', reason: 'check_not_proven:legacy_processes_exited', publishAuthorized: false });

    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('legacy child stop timeout')), 10000);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        code === 0 && !signal ? resolve() : reject(Error('legacy child stop failed: ' + code));
      });
    });
    child.send('stop');
    await exited;
    // Parent reaped its own child; check PID + kernel starttime to avoid a recycled PID.
    let sameProcess = false;
    try { sameProcess = startTicks(pid) === ticks; }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
    assert.equal(sameProcess, false, 'legacy process identity remains');
    assert.deepEqual(review('after', pid, ticks, [], {
      legacy_processes_exited: 'pass', legacy_writable_fds_drained: 'pass'
    }), {
      action: 'hold',
      reason: 'check_not_proven:legacy_db_wal_shm_denied',
      publishAuthorized: false
    });
    console.log('PASS Day 86 noon: kernel /proc showed live writable SQLite FD; after owned child exit PID/starttime is gone.');
    console.log('PASS release evidence review: 2 fixture checks pass, other 5 remain UNKNOWN => HOLD; publishAuthorized=false.');
    console.log('LIMIT: no authenticated host collector, global PID sweep, mount or rollback proof, real ACK or production authority. NO_GO.');
  } finally {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  throw Error('FAIL_CLOSED: unsupported lab mode');
}
