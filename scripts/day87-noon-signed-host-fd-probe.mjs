/**
 * Day 87 noon: bind observed Day 86 /proc kernel text to the Day 87
 * Ed25519 attestation contract. Disposable Linux fixture only.
 * Signatures, pinning, host identity and challenge are LAB-ONLY.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  canonicalWriterCollectorClaims,
  reviewSignedWriterCollectorArtifact,
  writerCollectorSigningBytes
} from '../dist/runtime/recovery-writer-collector-attestation.js';

if (process.platform !== 'linux') throw Error('FAIL_CLOSED: Linux /proc required');
const here = dirname(fileURLToPath(import.meta.url));
const run = spawnSync(process.execPath, [join(here, 'day86-noon-host-fd-probe.mjs')], {
  cwd: join(here, '..'), encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024
});
if (run.error || run.status !== 0) {
  throw Error('FAIL_CLOSED: Day 86 procfs experiment failed: ' +
    (run.error?.message || run.stderr || run.stdout || String(run.status)).slice(0, 1500));
}
const marker = 'DAY86_RAW_PROCFS_ARTIFACT_B64=';
const lines = run.stdout.split(/\r?\n/).filter(x => x.startsWith(marker));
if (lines.length !== 1) throw Error('FAIL_CLOSED: exactly one raw procfs artifact required');
const encoded = lines[0].slice(marker.length);
if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error('FAIL_CLOSED: base64 artifact malformed');
const rawArtifactBytes = Buffer.from(encoded, 'base64');
if (rawArtifactBytes.length === 0 || rawArtifactBytes.length > 1024 * 1024 ||
    rawArtifactBytes.toString('base64') !== encoded) {
  throw Error('FAIL_CLOSED: invalid raw artifact bytes');
}
const observed = JSON.parse(rawArtifactBytes.toString('utf8'));
assert.equal(observed.schemaVersion, 1);
assert.equal(observed.source, 'linux-procfs-owned-fixture');
assert.equal(observed.hostId, hostname());
assert.match(observed.mountNamespaceId, /^mnt:\[\d+\]$/);
assert.ok(Number.isSafeInteger(observed.observedAtEpochMs));
assert.ok(typeof observed.rawProcStat === 'string' &&
  observed.rawProcStat.includes(') '), 'must carry raw /proc/<pid>/stat');
assert.ok(observed.fdSnapshots.some(fd =>
  fd.file === '/agent.sqlite' &&
  /^flags:\s*[0-7]+/m.test(fd.rawFdinfo) &&
  ([1, 2].includes(parseInt(/^flags:\s*([0-7]+)/m.exec(fd.rawFdinfo)[1], 8) & 3))
), 'must carry real writable sqlite /proc/fdinfo text');

const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const rogue = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const claims = {
  schemaVersion: 1,
  deploymentId: 'staging:day87-noon',
  releaseId: 'release-' + randomBytes(8).toString('hex'),
  observerId: 'fixture-proc-parent',
  hostId: observed.hostId,
  mountNamespaceId: observed.mountNamespaceId,
  challengeId: 'nonce-' + randomBytes(16).toString('hex'),
  observedAtEpochMs: observed.observedAtEpochMs,
  artifactSha256: createHash('sha256').update(rawArtifactBytes).digest('hex')
};
const payloadBytes = canonicalWriterCollectorClaims(claims);
const signed = key => ({
  keyId: 'fixture-ephemeral-ed25519',
  payloadBytes,
  signatureHex: Buffer.from(
    sign(null, writerCollectorSigningBytes(payloadBytes), key)
  ).toString('hex'),
  rawArtifactBytes
});
const input = {
  intent: 'isolated_review',
  deploymentId: claims.deploymentId,
  releaseId: claims.releaseId,
  expectedObserverId: claims.observerId,
  expectedHostId: claims.hostId,
  expectedMountNamespaceId: claims.mountNamespaceId,
  expectedChallengeId: claims.challengeId,
  nowEpochMs: Date.now(),
  pinnedKeyId: 'fixture-ephemeral-ed25519',
  pinnedEd25519PublicKeyPem: publicKey,
  artifact: signed(privateKey)
};
const ready = {
  action: 'ready_for_isolated_attestation_binding_test',
  artifactSha256: claims.artifactSha256,
  publishAuthorized: false
};
assert.deepEqual(reviewSignedWriterCollectorArtifact(input), ready);
function reject(mutation, reason) {
  assert.deepEqual(reviewSignedWriterCollectorArtifact({ ...input, ...mutation }),
    { action: 'hold', reason, publishAuthorized: false });
}
reject({ expectedHostId: 'other-fixture-host' }, 'signed_target_mismatch');
reject({ expectedMountNamespaceId: 'mnt:[999]' }, 'signed_target_mismatch');
reject({ releaseId: 'other-release' }, 'signed_target_mismatch');
reject({ expectedChallengeId: 'nonce-different-challenge-01' }, 'challenge_mismatch');
reject({ pinnedEd25519PublicKeyPem: rogue.publicKey }, 'collector_signature_invalid');
reject({ artifact: signed(rogue.privateKey) }, 'collector_signature_invalid');
reject({ artifact: {
  ...input.artifact, rawArtifactBytes: Buffer.from('tampered /proc fdinfo')
} }, 'raw_artifact_digest_mismatch');
reject({ intent: 'production_release' }, 'production_attestation_not_authorized');
// Day 87 evening MUST address the replay gap: signature verification is stateless.
assert.deepEqual(reviewSignedWriterCollectorArtifact(input), ready,
  'same signed report is replayable until a trusted nonce store enforces one-time use');
console.log('PASS Day 87 noon: actual disposable /proc stat+fdinfo bytes signed and verified; host/ns/release/challenge/tampering rejected.');
console.log('PASS: second submission also verifies (intentional replay counterexample); publishAuthorized=false.');
console.log('LIMIT: temporary keys, local self-nominated host identity and no persistent challenge consumption; all 7 production OS checks remain unproven. NO_GO.');
