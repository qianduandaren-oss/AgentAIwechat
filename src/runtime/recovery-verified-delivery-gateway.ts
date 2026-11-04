import { SQLiteRecoveryOutboxDeliveryClaimer } from "./recovery-outbox-delivery-lease.js";
import type { RecoveryOutboxConsumerContract } from "./recovery-outbox-delivery-contract.js";
import { acknowledgeVerifiedConsumerDelivery, type VerifiedConsumerAckAdapter } from "./recovery-outbox-authenticated-dispatch.js";

/** Candidate trusted-bootstrap entry; legacy dispatcher remains a release blocker. */
export class RecoveryVerifiedDeliveryGateway {
  constructor(
    private readonly store: SQLiteRecoveryOutboxDeliveryClaimer,
    private readonly adapter: VerifiedConsumerAckAdapter,
    private readonly consumer: RecoveryOutboxConsumerContract,
    private readonly consumerId: string
  ) {}
  claim(input: {outboxId: string; workerId: string; nowEpochMs: number; leaseMs: number}) {
    if (!this.consumerId.trim()) return {action: "hold" as const, reason: "consumer_identity_missing"};
    return this.store.claim({...input, consumer: this.consumer});
  }
  confirm(input: {outboxId: string; eventId: string; leaseToken: string; rawResponse: unknown; nowEpochMs: number; maxEvidenceAgeMs: number}) {
    if (!this.consumerId.trim()) return Promise.resolve({action: "hold" as const, reason: "consumer_identity_missing"});
    return acknowledgeVerifiedConsumerDelivery(this.store, this.adapter, {...input, consumerId: this.consumerId});
  }
  inspect(outboxId: string) { return this.store.inspect(outboxId); }
}
