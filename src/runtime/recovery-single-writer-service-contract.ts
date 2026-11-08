/**
 * Day 79 morning — single-writer service port (TYPE-ONLY, NOT A SECURITY GATE).
 *
 * Only a trusted deployment process may construct its implementation.
 * Worker ID, Writer Epoch, consumer contract and current time must come from
 * trusted server-side dependencies, never arbitrary client request fields.
 *
 * This interface does NOT revoke legacy SQLite file write access, authenticate
 * a consumer ACK, or make Recovery into a production-ready service.
 */
export interface RecoverySingleWriterServicePort {
  claimOutbox(input: Readonly<{
    outboxId: string;
  }>): Promise<
    | { action: "hold"; reason: string }
    | { action: "busy"; eventId: string }
    | { action: "already_dispatched"; eventId: string }
    | { action: "claimed"; eventId: string; leaseToken: string }
  >;

  confirmOutbox(input: Readonly<{
    outboxId: string;
    eventId: string;
    leaseToken: string;
    rawConsumerResponse: unknown;
  }>): Promise<
    | { action: "hold"; reason: string }
    | { action: "dispatched"; eventId: string }
    | { action: "already_dispatched"; eventId: string }
  >;
}
