/** Day 98 noon: read-only candidate classification, never provider authority. */
import type { Day97FenceCommand } from "./recovery-writer-remote-revocation-barrier-lab.js";

type Scope = Pick<Day97FenceCommand,
  "deploymentId" | "releaseId" | "attemptId" | "barrierId" | "resourceId">;
export interface Day98InflightIntent extends Scope {
  providerId: string; commandId: string; effectId: string; idempotencyKey: string;
  originalFence: number; commandSha256: string;
  targetFloor: number; barrierCommandSha256: string;
}
export interface Day98InstallObservation extends Scope {
  floor: number; commandSha256: string; journalId: string; installOrdinal: number;
}
export type Day98EffectObservation =
  | { kind: "unknown" }
  | { kind: "applied"; binding: Day98InflightIntent; receiptId: string;
      journalId?: string; commitOrdinal?: number }
  | { kind: "not_applied"; binding: Day98InflightIntent;
      final: boolean; noLateCommitGuarantee: boolean };
export type Day98Classification = "historical_applied" | "final_not_applied" |
  "unresolved" | "invariant_violation";
const id = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(x);
const sha = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const pos = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const scopeKeys = ["deploymentId","releaseId","attemptId","barrierId","resourceId"] as const;
const intentKeys = [...scopeKeys,"providerId","commandId","effectId","idempotencyKey",
  "originalFence","commandSha256","targetFloor","barrierCommandSha256"] as const;
const validIntent = (i: Day98InflightIntent) => !!i &&
  [...scopeKeys,"providerId","commandId","effectId","idempotencyKey"].every(k =>
    id(i[k as keyof Day98InflightIntent])) &&
  sha(i.commandSha256) && sha(i.barrierCommandSha256) &&
  pos(i.originalFence) && pos(i.targetFloor) && i.originalFence < i.targetFloor;
const result = (classification: Day98Classification, reason: string, appliedObserved = false) =>
  ({ classification, reason, appliedObserved, observationTrusted: false as const,
    automaticResend: false as const, publishAuthorized: false as const });

/** Ordinals must refer to the SAME durable resource journal; candidate values
 * are not authenticated and must never be passed to the real receipt finalizer. */
export function classifyDay98InflightEffect(
  intent: Day98InflightIntent, install: Day98InstallObservation | undefined,
  observations: readonly Day98EffectObservation[]
) {
  try {
    if (!validIntent(intent) || !Array.isArray(observations))
      return result("invariant_violation","invalid_intent_or_observations");
    const obs: readonly Day98EffectObservation[] = observations;
    const bound = (o: Exclude<Day98EffectObservation,{kind:"unknown"}>) =>
      !!o.binding && intentKeys.every(k => o.binding[k] === intent[k]);
    if (obs.some(o => !o || !["unknown","applied","not_applied"].includes(o.kind)))
      return result("invariant_violation","invalid_observation");
    const known = obs.filter((o): o is Exclude<Day98EffectObservation,{kind:"unknown"}> => o.kind !== "unknown");
    const applied = known.some(o => o.kind === "applied" && bound(o) && id(o.receiptId));
    if (known.some(o => !bound(o)))
      return result("invariant_violation","observation_identity_mismatch",applied);
    if (known.length > 1)
      return result("invariant_violation","multiple_terminal_observations",applied);
    if (install && (!scopeKeys.every(k => install[k] === intent[k]) ||
        install.floor !== intent.targetFloor || install.commandSha256 !== intent.barrierCommandSha256 ||
        !id(install.journalId) || !pos(install.installOrdinal)))
      return result("invariant_violation","install_binding_conflict",applied);
    const o = known[0];
    if (!o) return result("unresolved","observation_unavailable");
    if (o.kind === "not_applied") {
      return o.final === true && o.noLateCommitGuarantee === true
        ? result("final_not_applied","fixture_final_absence_no_late_commit")
        : result("unresolved","finality_or_no_late_commit_missing");
    }
    if (!id(o.receiptId)) return result("invariant_violation","invalid_receipt");
    if (!install || !id(o.journalId) || o.journalId !== install.journalId || !pos(o.commitOrdinal))
      return result("unresolved","resource_order_unproven",true);
    return o.commitOrdinal < install.installOrdinal
      ? result("historical_applied","fixture_commit_before_install",true)
      : result("invariant_violation","obsolete_fence_commit_at_or_after_install",true);
  } catch {
    return result("unresolved","observation_read_failed");
  }
}

export interface Day98InflightRow {
  intent: Day98InflightIntent;
  install?: Day98InstallObservation;
  observations: readonly Day98EffectObservation[];
}

/** Only internal uniqueness is checked, NOT authoritative inventory coverage. */
export function summarizeDay98InflightInventory(rows: readonly Day98InflightRow[]) {
  const report = (inventoryReason: string, effects: ReturnType<typeof classifyDay98InflightEffect>[] = []) =>
    ({ inventoryReason, effects, inventoryTrusted: false as const,
      automaticResend: false as const, publishAuthorized: false as const });
  try {
    if (!Array.isArray(rows) || rows.length === 0) return report("inventory_missing_or_empty");
    const typed: readonly Day98InflightRow[] = rows;
    const effectIds = new Set<string>(), providerKeys = new Set<string>();
    for (const row of typed) {
      if (!row || !validIntent(row.intent)) return report("inventory_invalid");
      const i = row.intent, key = JSON.stringify([i.providerId,i.idempotencyKey]);
      if (effectIds.has(i.effectId) || providerKeys.has(key)) return report("inventory_identity_conflict");
      effectIds.add(i.effectId); providerKeys.add(key);
    }
    return report("fixture_inventory_classified_not_authority",
      typed.map(row => classifyDay98InflightEffect(row.intent,row.install,row.observations)));
  } catch { return report("inventory_read_failed"); }
}
