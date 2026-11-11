import { strict as assert } from "node:assert";
import { RecoveryWriterMtlsTrustController } from "../runtime/recovery-writer-mtls-trust-controller.js";
import type { MtlsPeerRegistration } from "../runtime/recovery-writer-mtls-transport.js";

let now = 10_000;
const fpA = Array(32).fill("AA").join(":");
const fpB = Array(32).fill("BB").join(":");
const clock = () => now;
const controller = new RecoveryWriterMtlsTrustController("staging-day82", clock);
const peerA = { fingerprint256: fpA, subject: "svc:old", grantedOperations: ["claim_outbox"] as const };
const peerB = { fingerprint256: fpB, subject: "svc:new", grantedOperations: ["confirm_outbox"] as const };
const snapshot = (revision: number, peers: readonly MtlsPeerRegistration[] = [peerA]) => ({
  deploymentId: "staging-day82", revision,
  issuedAtEpochMs: now, expiresAtEpochMs: now + 1_000, peers
});
assert.equal(controller.resolve(fpA), null);
assert.equal(controller.install(snapshot(1)).action, "ready_for_isolated_rotation_test");
assert.equal(controller.resolve(fpA)?.subject, "svc:old");
assert.equal(controller.resolve(fpB), null);
assert.equal(controller.install({ ...snapshot(2), peers: [peerA, peerA] }).action, "hold");
assert.equal(controller.resolve(fpA), null); // Invalid policy update must fail closed.
assert.equal(controller.install(snapshot(3, [peerB])).action, "ready_for_isolated_rotation_test");
assert.equal(controller.resolve(fpA), null);
assert.equal(controller.resolve(fpB)?.subject, "svc:new");
assert.equal(controller.install(snapshot(2)).action, "hold"); // Rollback is denied.
assert.equal(controller.resolve(fpB), null);
assert.equal(controller.install({ ...snapshot(4), deploymentId: "wrong-stage" }).action, "hold");
assert.equal(controller.install(snapshot(5, [peerB])).action, "ready_for_isolated_rotation_test");
now += 1_001;
assert.equal(controller.resolve(fpB), null); // Expired snapshot cannot authenticate.
assert.equal(controller.install(snapshot(6, [peerB])).action, "ready_for_isolated_rotation_test");
now -= 1;
assert.equal(controller.resolve(fpB), null); // Clock regression must fail closed.
const restarted = new RecoveryWriterMtlsTrustController("staging-day82", () => 12_000, 6);
const oldSnapshot = { deploymentId: "staging-day82", revision: 6,
  issuedAtEpochMs: 12_000, expiresAtEpochMs: 13_000, peers: [peerB] };
assert.equal(restarted.install(oldSnapshot).action, "hold"); // Trusted watermark.
assert.equal(restarted.install({ ...oldSnapshot, revision: 7 }).action, "ready_for_isolated_rotation_test");
assert.equal(restarted.resolve(fpB)?.subject, "svc:new");
console.log("PASS Day 82 rotation: revocation, stale revision, deployment, expiry, clock and restart watermark");
