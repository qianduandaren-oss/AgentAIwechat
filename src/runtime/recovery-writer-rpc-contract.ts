/**
 * Day 81 morning — candidate RPC/IPC WIRE contract only.
 *
 * This module does not listen on a socket, authenticate a caller, authorize a
 * request, validate runtime JSON, or grant SQLite file access.
 * A transport adapter must establish identity independently of request fields.
 * A trusted service (Day 79 candidate) owns epoch, ownerId, clock and ACK verifier.
 */
export type RecoveryWriterOperation = "claim_outbox" | "confirm_outbox";

/** Client-controlled, untrusted payload. No dbPath, ownerId, epoch, time or consumer contract. */
export type RecoveryWriterWireRequest =
  | Readonly<{
      requestId: string;
      operation: "claim_outbox";
      outboxId: string;
    }>
  | Readonly<{
      requestId: string;
      operation: "confirm_outbox";
      outboxId: string;
      eventId: string;
      leaseToken: string;
      /** Unverified bytes/object; ONLY a trusted server-side ACK adapter can validate it. */
      rawConsumerResponse: unknown;
    }>;

/**
 * Server-owned context from a verified IPC/RPC channel.
 * Never deserialize this from the wire body or an untrusted forwarded header.
 * Type checking is not authentication: the transport must prove the identity.
 */
export type VerifiedTransportCaller = Readonly<{
  subject: string;
  mechanism: "verified_peer_identity" | "mutual_tls";
  grantedOperations: readonly RecoveryWriterOperation[];
}>;

export type RecoveryWriterWireResponse =
  | Readonly<{ requestId: string; action: "hold"; reason: string }>
  | Readonly<{ requestId: string; action: "busy"; eventId: string }>
  | Readonly<{ requestId: string; action: "already_dispatched"; eventId: string }>
  | Readonly<{ requestId: string; action: "claimed"; eventId: string; leaseToken: string }>
  | Readonly<{ requestId: string; action: "dispatched"; eventId: string }>;

/**
 * Candidate adapter contract. Noon practice will add runtime allowlist validation,
 * authorization and fail-closed dispatch. No implementation exists yet.
 */
export interface RecoveryWriterRequestHandler {
  handle(untrustedRequest: unknown, caller: VerifiedTransportCaller | null):
    Promise<RecoveryWriterWireResponse>;
}
