/**
 * Day 85 evening: conservative audit of runtime calls to a legacy Writer
 * constructor. It is not a build-system policy, dynamic import analyzer,
 * filesystem restriction or proof of OS isolation. NO_GO regardless of PASS.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'src', 'runtime');
const writerFile = join(runtime, 'recovery-fenced-outbox-delivery.ts');
const factoryFile = join(runtime, 'recovery-writer-isolated-trust-bound-factory.ts');
const pattern = /\bnew\s+SQLiteFencedOutboxDelivery\s*\(/g;

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

function constructors(source) {
  return [...source.matchAll(pattern)].map(match => {
    const line = source.slice(0, match.index).split('\n').length;
    return line;
  });
}

const occurrences = filesUnder(runtime).flatMap(path =>
  constructors(readFileSync(path, 'utf8')).map(line => ({
    path: relative(root, path).replaceAll('\\', '/'), line
  }))
);
const expectedPath = 'src/runtime/recovery-writer-isolated-trust-bound-factory.ts';
assert.deepEqual(occurrences.map(hit => hit.path), [expectedPath],
  'unexpected direct Writer construction in runtime; audit the call site before extending allowed paths');
const factory = readFileSync(factoryFile, 'utf8');
assert.match(factory, /bootstrapRecoveredWriterTrust\s*\(/);
assert.match(factory, /activeTrustWatermark:\s*review\.activeWatermark/);
assert.match(factory, /writer\.assertTrustBoundForIsolatedStartup\s*\(/);
assert.match(factory, /publishAuthorized:\s*false/);
assert.ok(factory.indexOf('bootstrapRecoveredWriterTrust(') < factory.indexOf('new SQLiteFencedOutboxDelivery('));
assert.ok(factory.indexOf('new SQLiteFencedOutboxDelivery(') < factory.indexOf('writer.assertTrustBoundForIsolatedStartup('));
const legacy = readFileSync(writerFile, 'utf8');
assert.match(legacy, /if\s*\(!active\)\s*return/);
assert.match(legacy, /constructor\s*\(\s*path:\s*string\s*,\s*options\?/);
// Explicit negative control: the scanner must notice a direct constructor.
assert.equal(constructors('const unsafe = new SQLiteFencedOutboxDelivery(path);').length, 1);
assert.equal(constructors('const safe = await createIsolatedTrustBoundRecoveryWriter(input);').length, 0);
console.log('PASS Day 85 evening: runtime direct-constructor sites restricted to isolated factory (' + occurrences.length + ').');
console.log('LIMIT: legacy constructor remains callable; aliases, dynamic code, tests and direct SQL are not security-enforced by this scanner. Production NO_GO.');
