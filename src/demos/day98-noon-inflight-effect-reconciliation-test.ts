import { strict as assert } from "node:assert";
import { classifyDay98InflightEffect as classify, summarizeDay98InflightInventory as summarize,
  type Day98InflightIntent, type Day98InstallObservation, type Day98EffectObservation
} from "../runtime/recovery-writer-inflight-effect-reconciliation.js";
import { day96LabSha256 as hash } from "../runtime/recovery-writer-atomic-authorization-fence-lab.js";

const scope = { deploymentId:"d",releaseId:"r",attemptId:"a",barrierId:"b",resourceId:"B" };
const intent: Day98InflightIntent = { ...scope, providerId:"video", commandId:"cmd",
  effectId:"effect", idempotencyKey:"key", originalFence:41, targetFloor:42,
  commandSha256:hash("create-video"), barrierCommandSha256:hash("install-42") };
const install: Day98InstallObservation = { ...scope, floor:42,
  commandSha256:intent.barrierCommandSha256, journalId:"B-journal", installOrdinal:105 };
const applied = { kind:"applied", binding:{...intent}, receiptId:"receipt",
  journalId:"B-journal", commitOrdinal:104 } as const;
const negative = { kind:"not_applied", binding:{...intent},
  final:true, noLateCommitGuarantee:true } as const;
const check = (obs: readonly Day98EffectObservation[], expected: string,
  i: Day98InstallObservation | undefined = install) => {
  const r = classify(intent,i,obs);
  assert.equal(r.classification,expected);
  assert.equal(r.automaticResend,false);
  assert.equal(r.publishAuthorized,false);
  assert.equal(r.observationTrusted,false);
  return r;
};
const historical = check([applied],"historical_applied");
assert.equal(historical.reason,"fixture_commit_before_install");
assert.equal(historical.appliedObserved,true);
check([negative],"final_not_applied");
check([{...negative,final:false}],"unresolved");
check([{...negative,noLateCommitGuarantee:false}],"unresolved");
check([],"unresolved");
check([{kind:"unknown"}],"unresolved");
check([{...applied,commitOrdinal:106}],"invariant_violation");
check([{...applied,commitOrdinal:105}],"invariant_violation");
assert.equal(check([{...applied,journalId:"other"}],"unresolved").appliedObserved,true);
assert.equal(check([{...applied,commitOrdinal:undefined}],"unresolved").appliedObserved,true);
assert.equal(classify(intent,undefined,[applied]).reason,"resource_order_unproven");
check([{...applied,binding:{...intent,idempotencyKey:"wrong"}}],"invariant_violation");
check([{...applied,binding:{...intent,attemptId:"other"}}],"invariant_violation");
check([{...applied,binding:{...intent,providerId:"other"}}],"invariant_violation");
check([applied,negative],"invariant_violation");
check([applied,applied],"invariant_violation");
check([applied],"invariant_violation",{...install,commandSha256:hash("wrong")});
const row = {intent,install,observations:[applied]};
assert.equal(summarize([row,row]).inventoryReason,"inventory_identity_conflict");
assert.equal(summarize([{...row,intent:{...intent,effectId:"other"}},row]).inventoryReason,"inventory_identity_conflict");
assert.equal(summarize([]).inventoryReason,"inventory_missing_or_empty");
const report = summarize([row]);
assert.equal(report.effects.length,1);
assert.equal(report.effects[0].classification,"historical_applied");
assert.equal(report.inventoryTrusted,false);
assert.equal(report.publishAuthorized,false);
console.log("Day 98 in-flight effect reconciliation fixture checks passed (NO_GO)");
