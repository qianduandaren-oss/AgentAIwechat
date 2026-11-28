/** Read-only candidate comparison. No public evidence reader, ACL bypass or provider authority. */
import { reviewDay98InflightReleaseBoundary } from "./recovery-writer-inflight-release-boundary.js";
import { day99CanonicalCandidate, day99CanonicalIntent, type Day99FrozenIntent } from "./recovery-writer-historical-evidence-archive-lab.js";
import { day96LabSha256 as hash } from "./recovery-writer-atomic-authorization-fence-lab.js";
import type { Day98InflightRow, Day98EffectObservation } from "./recovery-writer-inflight-effect-reconciliation.js";
import type { Day95LifecycleReleaseInput } from "./recovery-writer-audit-gateway-lifecycle-release-boundary.js";
import type { Day97BarrierObservation } from "./recovery-writer-remote-revocation-release-boundary.js";
import type { Day96LabObservation } from "./recovery-writer-atomic-authorization-release-boundary.js";

type Terminal = Exclude<Day98EffectObservation,{kind:"unknown"}>;
export interface Day99ArchiveRecord {
  tenantId:string; runId:string; effectId:string; providerId:string; evidenceId:string;
  archiveId:string; originalActor:string; archivedBy:string; revision:number;
  canonicalJson:string; digest:string; source:string;
}
/** Only an internally supplied fixture snapshot. Not an authenticated read capability. */
export interface Day99ArchiveSnapshot {
  tenantId:string; runId:string; frozen:readonly Day99FrozenIntent[];
  records:readonly Day99ArchiveRecord[];
}
const id=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9._:-]{1,256}$/.test(v);
const summary=(archiveReason:string,archiveRecordCount=0,missingTerminalCandidates=0,
  unexpectedArchiveCandidates=0,conflictingEffects=0)=>({archiveReason,archiveRecordCount,
  missingTerminalCandidates,unexpectedArchiveCandidates,conflictingEffects});
export function summarizeDay99Archive(rows?:readonly Day98InflightRow[],s?:Day99ArchiveSnapshot){
  if(!s)return summary("archive_snapshot_missing");
  if(!Array.isArray(rows)||!rows.length)return summary("archive_inflight_inventory_unavailable");
  try{
    if(!id(s.tenantId)||!id(s.runId)||!Array.isArray(s.frozen)||!Array.isArray(s.records))
      return summary("archive_snapshot_invalid");
    const frozen=new Map<string,Day99FrozenIntent>();
    for(const f of s.frozen as readonly Day99FrozenIntent[]){
      if(f.tenantId!==s.tenantId||f.runId!==s.runId||!id(f.originalActor)||frozen.has(f.intent.effectId))
        return summary("archive_scope_or_inventory_conflict");
      frozen.set(f.intent.effectId,f);
    }
    const expected=new Set<string>(),actual=new Set<string>(),seenEffects=new Set<string>();
    const byEffect=new Map<string,Set<string>>(),evidenceIds=new Set<string>();
    // A neutral evidence ID permits content comparison independent of the evidence envelope ID.
    for(const row of rows as readonly Day98InflightRow[]){
      const f=frozen.get(row.intent.effectId);
      if(!f||seenEffects.has(row.intent.effectId)||day99CanonicalIntent(f.intent)!==day99CanonicalIntent(row.intent))
        return summary("archive_scope_or_inventory_conflict");
      seenEffects.add(row.intent.effectId);
      for(const o of row.observations){
        if(o.kind==="unknown")continue;
        const key=day99CanonicalCandidate(f,"comparison",o);
        if(key===null)return summary("archive_terminal_candidate_invalid");
        expected.add(key);
      }
    }
    if(seenEffects.size!==frozen.size)return summary("archive_scope_or_inventory_conflict");
    for(const rec of s.records as readonly Day99ArchiveRecord[]){
      const f=frozen.get(rec.effectId);
      if(!f||rec.tenantId!==s.tenantId||rec.runId!==s.runId||rec.providerId!==f.intent.providerId||
        rec.originalActor!==f.originalActor||!id(rec.archivedBy)||!id(rec.evidenceId)||
        !Number.isSafeInteger(rec.revision)||rec.revision<=0||rec.source!=="synthetic_candidate")
        return summary("archive_scope_or_inventory_conflict");
      const identity=JSON.stringify([rec.tenantId,rec.providerId,rec.evidenceId]);
      if(evidenceIds.has(identity))return summary("archive_duplicate_evidence_identity");
      evidenceIds.add(identity);
      if(typeof rec.canonicalJson!=="string"||rec.canonicalJson.length>16384||
        rec.archiveId!==hash(identity)||rec.digest!==hash(rec.canonicalJson))
        return summary("archive_digest_or_encoding_conflict");
      const encoded=JSON.parse(rec.canonicalJson);
      const tuple=JSON.parse(encoded[5]);
      let o:Terminal;
      if(tuple[0]==="applied")o={kind:"applied",binding:f.intent,receiptId:tuple[1],
        ...(tuple[2]===null?{}:{journalId:tuple[2]}),...(tuple[3]===null?{}:{commitOrdinal:tuple[3]})};
      else if(tuple[0]==="not_applied")o={kind:"not_applied",binding:f.intent,final:tuple[1],noLateCommitGuarantee:tuple[2]};
      else return summary("archive_digest_or_encoding_conflict");
      if(day99CanonicalCandidate(f,rec.evidenceId,o)!==rec.canonicalJson)
        return summary("archive_digest_or_encoding_conflict");
      const key=day99CanonicalCandidate(f,"comparison",o);
      if(key===null)return summary("archive_digest_or_encoding_conflict");
      actual.add(key);
      const set=byEffect.get(rec.effectId)??new Set<string>();set.add(key);byEffect.set(rec.effectId,set);
    }
    const missing=[...expected].filter(k=>!actual.has(k)).length;
    const unexpected=[...actual].filter(k=>!expected.has(k)).length;
    const conflicts=[...byEffect.values()].filter(v=>v.size>1).length;
    const reason=conflicts?"fixture_archive_distinct_terminal_candidates":
      missing||unexpected?"fixture_archive_coverage_mismatch":
      !expected.size?"fixture_archive_no_terminal_candidates":"fixture_archive_matches_not_authority";
    return summary(reason,s.records.length,missing,unexpected,conflicts);
  }catch{return summary("archive_snapshot_read_or_encoding_failed");}
}
export async function reviewDay99HistoricalEvidenceArchiveReleaseBoundary(
  input:Day95LifecycleReleaseInput,barrier?:Day97BarrierObservation,rows?:readonly Day98InflightRow[],
  archive?:Day99ArchiveSnapshot,atomic?:Day96LabObservation){
  const prior=await reviewDay98InflightReleaseBoundary(input,barrier,rows,atomic);
  const a=input?.intent!=="isolated_review"?summary("archive_not_evaluated"):
    prior.inflightReason!=="fixture_inventory_classified_not_authority"?
      summary("archive_inflight_inventory_unavailable"):summarizeDay99Archive(rows,archive);
  return {...prior,...a,archiveObservationTrusted:false as const,automaticResend:false as const,
    publishAuthorized:false as const,action:"hold" as const,
    blockers:[...new Set([...prior.blockers,"archive:"+a.archiveReason,
      "archive_candidate_provenance_unverified","archive_inventory_authority_unverified",
      "archive_production_read_authority_unverified","production_release_not_authorized"])]};
}
