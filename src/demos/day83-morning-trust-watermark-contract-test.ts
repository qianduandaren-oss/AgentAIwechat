import { strict as assert } from "node:assert";
import { reviewRecoveryWriterTrustBootstrap as review } from
  "../runtime/recovery-writer-trust-watermark-contract.js";

const durable = {
  deploymentId: "staging-day83", revision: 9, policySha256: "a".repeat(64)
};
const args = {
  deploymentId: "staging-day83", trustedSourceAuthenticated: true,
  durable, candidate: { ...durable, revision: 10, policySha256: "b".repeat(64) }
};
assert.deepEqual(review(args), {
  action: "ready_for_isolated_bootstrap_test",
  mode: "advance_requires_durable_cas", publishAuthorized: false
});
assert.equal(review({ ...args, candidate: durable }).action, "ready_for_isolated_bootstrap_test");
assert.equal(review({ ...args, candidate: durable }).action, "ready_for_isolated_bootstrap_test");
assert.equal(review({ ...args, candidate: { ...durable, policySha256: "b".repeat(64) } }).action, "hold");
assert.equal(review({ ...args, candidate: { ...durable, revision: 8 } }).action, "hold");
assert.equal(review({ ...args, trustedSourceAuthenticated: false }).action, "hold");
assert.equal(review({ ...args, durable: null }).action, "hold");
assert.equal(review({ ...args, candidate: { ...durable, revision: 10, deploymentId: "other" } }).action, "hold");
assert.equal(review({ ...args, candidate: { ...durable, revision: 10, policySha256: "invalid" } }).action, "hold");
assert.equal(review({ ...args, durable: { ...durable, deploymentId: "other" } }).action, "hold");
assert.equal(review({ ...args, durable: { ...durable, revision: 10 }, candidate: durable }).action, "hold");
console.log("PASS Day 83 morning: trusted anchor, exact replay, CAS candidate, downgrade and same-revision conflict");
