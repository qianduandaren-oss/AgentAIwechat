import { SQLiteFencedOutboxDelivery } from "./recovery-fenced-outbox-delivery.js";
import { bootstrapRecoveredWriterTrust } from "./recovery-writer-durable-trust-bootstrap.js";
import { reviewRecoveryWriterCreationBoundary } from "./recovery-writer-creation-boundary.js";
import type {
  AuthenticatedRecoveryWriterPolicySource,
  RecoveryWriterTrustWatermark,
  RecoveryWriterTrustWatermarkStore
} from "./recovery-writer-trust-watermark-contract.js";

/**
 * Day 85 noon: ISOLATED LAB ONLY. One *strict* candidate entrypoint:
 * authenticated server-owned policy source -> durable bootstrap ->
 * advisory entry review -> SQLite connection with required active watermark ->
 * same-connection startup trust check. Never accept watermark from RPC JSON.
 *
 * WARNING: JS can still call the legacy constructor or direct SQL. Caller
 * must supply a genuinely authenticated source and a trusted store bound to
 * the same SQLite file. Neither this factory nor TS types grants OS isolation.
 */
export interface IsolatedTrustBoundWriterInput {
  readonly intent: "isolated_candidate" | "production_release";
  readonly deploymentId: string;
  readonly dbPath: string;
  readonly source: AuthenticatedRecoveryWriterPolicySource;
  readonly store: RecoveryWriterTrustWatermarkStore;
  readonly nowEpochMs: () => number;
}

export type IsolatedTrustBoundWriterResult =
  | Readonly<{
      action: "ready_for_isolated_factory_test";
      writer: SQLiteFencedOutboxDelivery;
      activeWatermark: RecoveryWriterTrustWatermark;
      publishAuthorized: false;
    }>
  | Readonly<{
      action: "hold";
      reason: string;
      publishAuthorized: false;
    }>;

const hold = (reason: string): IsolatedTrustBoundWriterResult =>
  ({ action: "hold", reason, publishAuthorized: false });

export async function createIsolatedTrustBoundRecoveryWriter(
  input: IsolatedTrustBoundWriterInput
): Promise<IsolatedTrustBoundWriterResult> {
  if (!input || input.intent !== "isolated_candidate") {
    return hold("production_or_invalid_intent_forbidden");
  }
  if (typeof input.dbPath !== "string" || !input.dbPath.trim()) {
    return hold("writer_database_path_invalid");
  }
  // The caller cannot provide a pre-approved watermark or caller identity:
  // run the existing authenticated bootstrap as part of the factory.
  const bootstrap = await bootstrapRecoveredWriterTrust({
    deploymentId: input.deploymentId,
    source: input.source, store: input.store, nowEpochMs: input.nowEpochMs
  });
  if (bootstrap.action === "hold") return hold(bootstrap.reason);

  const review = reviewRecoveryWriterCreationBoundary({
    intent: "isolated_candidate",
    entrypoint: "trust_bound_factory",
    deploymentId: input.deploymentId,
    trustedBootstrapWatermark: bootstrap.activeWatermark,
    writerWatermark: bootstrap.activeWatermark
  });
  if (review.action === "hold") return hold(review.reason);

  let writer: SQLiteFencedOutboxDelivery | undefined;
  try {
    writer = new SQLiteFencedOutboxDelivery(input.dbPath, {
      activeTrustWatermark: review.activeWatermark
    });
    // Fail before exposing the writer when the *writer's own connection*
    // cannot observe the exact expected row. Claim/ACK/Rotate will recheck
    // inside their write transactions; this startup check is not a substitute.
    writer.assertTrustBoundForIsolatedStartup();
    return {
      action: "ready_for_isolated_factory_test",
      writer,
      activeWatermark: review.activeWatermark,
      publishAuthorized: false
    };
  } catch {
    try { writer?.close(); } catch { /* preserve fail-closed result */ }
    return hold("writer_database_trust_unavailable");
  }
}
