/**
 * Day 80 evening: disposable Linux DAC lab, NOT a production security proof.
 * An already-open writable fd can survive chmod; a newly launched legacy
 * identity must fail to open the DB and create a directory entry.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, fsyncSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const PREFIX = join(tmpdir(), 'day80-evening-fd-lab.');
const mode = process.argv[2];
const fixture = process.argv[3];
function requireFixture(dir) {
  if (typeof dir !== 'string' || !dir.startsWith(PREFIX) ||
      !/^[A-Za-z0-9]{6}$/.test(dir.slice(PREFIX.length))) {
    throw new Error('FAIL_CLOSED: invalid disposable lab directory');
  }
}
function writeCheck(path, flags) {
  try {
    const fd = openSync(path, flags, 0o600);
    closeSync(fd);
    if (flags === 'wx') unlinkSync(path);
    return 'writable';
  } catch (e) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(e?.code)) return 'denied';
    throw e;
  }
}
if (mode === 'hold' || mode === 'fresh') {
  requireFixture(fixture);
  const db = join(fixture, 'agent.db');
  if (mode === 'fresh') {
    const dbAccess = writeCheck(db, 'r+');
    const dirAccess = writeCheck(join(fixture, '.canary-' + process.pid), 'wx');
    console.log(`FRESH file=${dbAccess} directory=${dirAccess}`);
  } else {
    const fd = openSync(db, 'r+');
    console.log('FD_READY');
    process.stdin.once('data', () => {
      try {
        writeSync(fd, Buffer.from('X'), 0, 1, 0);
        fsyncSync(fd);
        closeSync(fd);
        process.stdout.write('FD_WRITE_OK\n', () => process.exit(0));
      } catch (e) {
        console.error('FAIL_CLOSED: fd write failed', e);
        process.exitCode = 1;
      }
      process.stdin.pause();
    });
    process.stdin.resume();
  }
} else if (!mode) {
  if (process.platform !== 'linux') throw new Error('FAIL_CLOSED: requires Linux');
  const sudo = spawnSync('sudo', ['-n', '-u', 'nobody', '--', 'id', '-u'], {encoding:'utf8'});
  if (sudo.status !== 0 || sudo.stdout.trim() === '0' || !/^\d+$/.test(sudo.stdout.trim())) {
    throw new Error('FAIL_CLOSED: cannot launch a distinct unprivileged legacy identity');
  }
  const dir = mkdtempSync(PREFIX);
  const codeDir = mkdtempSync(join(tmpdir(), 'day80-evening-code.'));
  let held;
  try {
    chmodSync(codeDir, 0o755);
    const copied = join(codeDir, 'lab.mjs');
    copyFileSync(fileURLToPath(import.meta.url), copied);
    chmodSync(copied, 0o644);
    const db = join(dir, 'agent.db');
    writeFileSync(db, '0');
    chmodSync(db, 0o666);
    chmodSync(dir, 0o755);
    held = spawn('sudo', ['-n', '-u', 'nobody', '--', process.execPath, copied, 'hold', dir], {stdio:['pipe','pipe','pipe']});
    let stderr = '';
    held.stderr.setEncoding('utf8');
    held.stderr.on('data', chunk => { stderr += chunk; });
    const lines = createInterface({input:held.stdout})[Symbol.asyncIterator]();
    const nextLine = async () => {
      const timer = AbortSignal.timeout(10000);
      const result = await Promise.race([
        lines.next(),
        new Promise((_, reject) => timer.addEventListener('abort', () => reject(new Error('FAIL_CLOSED: child did not respond')), {once:true}))
      ]);
      if (result.done) throw new Error('FAIL_CLOSED: legacy process exited: ' + stderr);
      return result.value;
    };
    if (await nextLine() !== 'FD_READY') throw new Error('FAIL_CLOSED: legacy fd not opened');
    chmodSync(db, 0o600);
    chmodSync(dir, 0o700);
    const fresh = spawnSync('sudo', ['-n','-u','nobody','--',process.execPath,copied,'fresh',dir], {encoding:'utf8'});
    if (fresh.status !== 0 || fresh.stdout.trim() !== 'FRESH file=denied directory=denied') {
      throw new Error('FAIL_CLOSED: new legacy open was not conclusively denied: ' + fresh.stdout + ' ' + fresh.stderr);
    }
    const exited = new Promise(resolve => held.once('exit', resolve));
    held.stdin.write('GO\n');
    if (await nextLine() !== 'FD_WRITE_OK') throw new Error('FAIL_CLOSED: held fd did not prove bypass');
    if (await exited !== 0) throw new Error('FAIL_CLOSED: held fd process failed: ' + stderr);
    if (readFileSync(db, 'utf8') !== 'X') throw new Error('FAIL_CLOSED: held fd result missing');
    console.log('PASS Day 80 evening disposable lab: newly opened legacy paths denied; pre-opened legacy fd STILL writes');
    console.log('SCOPE: simulated chmod handoff; no production mount / WAL / SHM / rollback / RPC proof. Publish NO_GO.');
  } finally {
    if (held && held.exitCode === null) held.kill('SIGKILL');
    rmSync(dir, {recursive:true,force:true});
    rmSync(codeDir, {recursive:true,force:true});
  }
} else {
  throw new Error('FAIL_CLOSED: invalid mode');
}
