import { strict as assert } from "node:assert";
import { CutoverEvidenceGuard } from "../runtime/recovery-cutover-evidence-guard.js";
import type { TrustedDispatcherCutoverEvidence } from "../runtime/recovery-dispatcher-cutover-policy.js";

const all: TrustedDispatcherCutoverEvidence = {
  legacyDispatcherDisabled: true, rawAcknowledgeRestricted: true,
  verifiedAdapterConfigured: true, durableConsumerDedupeVerified: true,
  exclusiveSqliteWriter: true, noMixedVersionWorkers: true
};
let state = { ...all };
const guard = new CutoverEvidenceGuard({ collect: async () => ({ ...state }) });
assert.equal((await guard.check()).action, "allow_candidate");
state.noMixedVersionWorkers = false;
assert.deepEqual(await guard.check(), { action: "hold", reason: "noMixedVersionWorkers" });
state = { ...all };
assert.equal((await guard.check()).action, "allow_candidate");
const failing = new CutoverEvidenceGuard({ collect: async () => { throw Error("offline"); } });
assert.deepEqual(await failing.check(), { action: "hold", reason: "cutover_evidence_unavailable" });
console.log("Day 76 evening: 4 cutover recheck assertions passed");
