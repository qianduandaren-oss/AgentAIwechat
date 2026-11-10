import type {
  RecoveryWriterRequestHandler,
  RecoveryWriterWireRequest,
  RecoveryWriterWireResponse,
  VerifiedTransportCaller
} from "./recovery-writer-rpc-contract.js";
import type { RecoverySingleWriterServicePort } from "./recovery-single-writer-service-contract.js";

/**
 * Day 81 candidate boundary: accepts an UNTRUSTED JSON document as a UTF-8
 * string, not a decoded object or request headers. The real transport must
 * independently authenticate the caller and construct VerifiedTransportCaller.
 * This class neither opens a socket nor proves OS/SQLite isolation.
 */
const ID = /^[A-Za-z0-9._:-]+$/;
const MAX_DEFAULT_BYTES = 16_384;
const MAX_CONFIG_BYTES = 65_536;

type Rejected = { action: "hold"; requestId: string; reason: string };
type Parsed =
  | { action: "accepted"; request: RecoveryWriterWireRequest }
  | Rejected;

function hold(requestId: string, reason: string): Rejected {
  return { action: "hold", requestId, reason };
}

function boundedId(value: unknown, maximum: number): value is string {
  return typeof value === "string" &&
    value.length > 0 && value.length <= maximum && ID.test(value);
}

/** Reject unknown operations, additional top-level keys and oversized JSON. */
export function parseRecoveryWriterWireRequest(
  untrusted: unknown,
  maxBytes = MAX_DEFAULT_BYTES
): Parsed {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 128 || maxBytes > MAX_CONFIG_BYTES) {
    return hold("unavailable", "handler_configuration_invalid");
  }
  // An IPC/HTTP adapter should pass its raw decoded UTF-8 body, not arbitrary
  // JS objects that may contain getters, unexpected prototypes or fake context.
  if (typeof untrusted !== "string") {
    return hold("unavailable", "invalid_request_encoding");
  }
  if (new TextEncoder().encode(untrusted).byteLength > maxBytes) {
    return hold("unavailable", "request_too_large");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(untrusted) as unknown;
  } catch {
    return hold("unavailable", "invalid_json");
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return hold("unavailable", "invalid_request_shape");
  }
  const body = decoded as Record<string, unknown>;
  const requestId = boundedId(body.requestId, 128) ? body.requestId : "unavailable";
  if (!boundedId(body.requestId, 128)) {
    return hold(requestId, "invalid_request_id");
  }
  const operation = body.operation;
  if (operation !== "claim_outbox" && operation !== "confirm_outbox") {
    return hold(requestId, "unsupported_operation");
  }
  const allowed = operation === "claim_outbox"
    ? ["requestId", "operation", "outboxId"]
    : ["requestId", "operation", "outboxId", "eventId", "leaseToken", "rawConsumerResponse"];
  const keys = Object.keys(body);
  if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) {
    return hold(requestId, "unexpected_or_missing_field");
  }
  if (!boundedId(body.outboxId, 256)) return hold(requestId, "invalid_outbox_id");
  if (operation === "claim_outbox") {
    return { action: "accepted", request: {
      requestId, operation, outboxId: body.outboxId
    } };
  }
  if (!boundedId(body.eventId, 256) || !boundedId(body.leaseToken, 512)) {
    return hold(requestId, "invalid_confirmation_id");
  }
  // Treat the entire ACK as opaque UNVERIFIED JSON. Only the trusted consumer
  // adapter in RecoverySingleWriterCandidateService may authenticate it.
  return { action: "accepted", request: {
    requestId, operation, outboxId: body.outboxId,
    eventId: body.eventId, leaseToken: body.leaseToken,
    rawConsumerResponse: body.rawConsumerResponse
  } };
}

/** Caller context is trusted ONLY when created by an independently verified transport. */
function authorized(
  caller: VerifiedTransportCaller | null,
  operation: RecoveryWriterWireRequest["operation"]
): boolean {
  return caller !== null &&
    boundedId(caller.subject, 128) &&
    (caller.mechanism === "verified_peer_identity" || caller.mechanism === "mutual_tls") &&
    Array.isArray(caller.grantedOperations) &&
    caller.grantedOperations.length > 0 && caller.grantedOperations.length <= 2 &&
    caller.grantedOperations.every(op => op === "claim_outbox" || op === "confirm_outbox") &&
    caller.grantedOperations.includes(operation);
}

/**
 * Candidate adapter only. This is NOT a network listener or an authentication
 * implementation. Caller identity and grants must never come from JSON or
 * forwarded headers; deployment isolation, rate limits, replay handling and
 * audit logging remain separate requirements.
 */
export class RecoveryWriterRpcCandidateHandler implements RecoveryWriterRequestHandler {
  constructor(
    private readonly service: RecoverySingleWriterServicePort,
    private readonly maxRequestBytes = MAX_DEFAULT_BYTES
  ) {}

  async handle(
    untrustedRequest: unknown,
    caller: VerifiedTransportCaller | null
  ): Promise<RecoveryWriterWireResponse> {
    const parsed = parseRecoveryWriterWireRequest(untrustedRequest, this.maxRequestBytes);
    if (parsed.action === "hold") return parsed;
    const request = parsed.request;
    if (!authorized(caller, request.operation)) {
      return hold(request.requestId, "transport_identity_or_permission_denied");
    }
    try {
      if (request.operation === "claim_outbox") {
        const result = await this.service.claimOutbox({ outboxId: request.outboxId });
        return { requestId: request.requestId, ...result };
      }
      const result = await this.service.confirmOutbox({
        outboxId: request.outboxId,
        eventId: request.eventId,
        leaseToken: request.leaseToken,
        rawConsumerResponse: request.rawConsumerResponse
      });
      return { requestId: request.requestId, ...result };
    } catch {
      return hold(request.requestId, "trusted_service_unavailable");
    }
  }
}
