import { createServer, type Server, type TLSSocket } from "node:tls";
import type {
  RecoveryWriterOperation, RecoveryWriterRequestHandler, VerifiedTransportCaller
} from "./recovery-writer-rpc-contract.js";

/**
 * Day 82 noon — a small REAL mTLS server boundary for an isolated laboratory.
 *
 * createServer fixes requestCert=true and rejectUnauthorized=true. The TLS
 * stack validates the client certificate against the supplied CA. Only after
 * that handshake do we pin its SHA-256 fingerprint to a server-side ACL entry.
 * No caller identity or grants may come from JSON or a forwarded header.
 *
 * This is NOT production ready: no cert revocation/rotation service, durable
 * replay ledger, production deployment separation, or proven consumer ACK.
 */
export interface MtlsPeerRegistration {
  readonly fingerprint256: string;
  readonly subject: string;
  readonly grantedOperations: readonly RecoveryWriterOperation[];
}
export interface RecoveryWriterMtlsOptions {
  readonly keyPem: string;
  readonly certPem: string;
  readonly clientCaPem: string;
  readonly peers: readonly MtlsPeerRegistration[];
  readonly handler: RecoveryWriterRequestHandler;
  readonly maxBodyBytes?: number;
  readonly requestTimeoutMs?: number;
}

const SUBJECT = /^[A-Za-z0-9._:-]{1,128}$/;
const FINGERPRINT = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;
const MAX_BODY = 16_384;
const MAX_TIMEOUT = 30_000;

function registryFor(peers: readonly MtlsPeerRegistration[]): Map<string, VerifiedTransportCaller> {
  if (!Array.isArray(peers) || peers.length < 1 || peers.length > 128) {
    throw new Error("mtls_peer_registry_invalid");
  }
  const registry = new Map<string, VerifiedTransportCaller>();
  for (const peer of peers) {
    if (!peer || typeof peer.fingerprint256 !== "string" ||
        !FINGERPRINT.test(peer.fingerprint256.toUpperCase()) ||
        !SUBJECT.test(peer.subject) ||
        !Array.isArray(peer.grantedOperations) ||
        peer.grantedOperations.length < 1 || peer.grantedOperations.length > 2 ||
        peer.grantedOperations.some((op: RecoveryWriterOperation) => op !== "claim_outbox" && op !== "confirm_outbox") ||
        new Set(peer.grantedOperations).size !== peer.grantedOperations.length) {
      throw new Error("mtls_peer_registration_invalid");
    }
    const key = peer.fingerprint256.toUpperCase();
    if (registry.has(key)) throw new Error("mtls_peer_fingerprint_duplicate");
    registry.set(key, Object.freeze({
      subject: peer.subject,
      mechanism: "mutual_tls" as const,
      grantedOperations: Object.freeze([...peer.grantedOperations])
    }));
  }
  return registry;
}

function verifiedCaller(
  socket: TLSSocket, registry: Map<string, VerifiedTransportCaller>
): VerifiedTransportCaller | null {
  // Handshake status is furnished by Node's TLS stack, not client JSON.
  if (socket.authorized !== true || socket.encrypted !== true) return null;
  const certificate = socket.getPeerCertificate();
  const fingerprint = certificate?.fingerprint256;
  if (typeof fingerprint !== "string") return null;
  return registry.get(fingerprint.toUpperCase()) ?? null;
}

/** Create a TLS listener; caller must bind it only in an isolated test deployment. */
export function createRecoveryWriterMtlsCandidateServer(options: RecoveryWriterMtlsOptions): Server {
  if (!options || typeof options.keyPem !== "string" || !options.keyPem ||
      typeof options.certPem !== "string" || !options.certPem ||
      typeof options.clientCaPem !== "string" || !options.clientCaPem ||
      !options.handler || typeof options.handler.handle !== "function") {
    throw new Error("mtls_server_configuration_invalid");
  }
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 128 || maxBodyBytes > MAX_BODY ||
      !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 ||
      requestTimeoutMs > MAX_TIMEOUT) {
    throw new Error("mtls_server_limits_invalid");
  }
  const registry = registryFor(options.peers);
  return createServer({
    key: options.keyPem, cert: options.certPem, ca: options.clientCaPem,
    requestCert: true, rejectUnauthorized: true, minVersion: "TLSv1.3"
  }, socket => {
    const caller = verifiedCaller(socket, registry);
    if (!caller) {
      socket.destroy();
      return;
    }
    socket.setEncoding("utf8");
    socket.setTimeout(requestTimeoutMs, () => socket.destroy());
    let raw = "";
    let consumed = false;
    // One newline-framed JSON request per TLS connection. No implicit retries.
    socket.on("data", chunk => {
      if (consumed) return;
      raw += chunk;
      if (new TextEncoder().encode(raw).byteLength > maxBodyBytes + 1) {
        consumed = true;
        socket.end(JSON.stringify({
          requestId: "unavailable", action: "hold", reason: "request_too_large"
        }) + "\n");
        return;
      }
      const newline = raw.indexOf("\n");
      if (newline === -1) return;
      consumed = true;
      if (raw.slice(newline + 1).length !== 0) {
        socket.end(JSON.stringify({
          requestId: "unavailable", action: "hold", reason: "invalid_rpc_frame"
        }) + "\n");
        return;
      }
      const message = raw.slice(0, newline);
      // The existing Day 81 parser/Admission validates JSON, ACL, replay and audit.
      void options.handler.handle(message, caller).then(
        response => { if (!socket.destroyed) socket.end(JSON.stringify(response) + "\n"); },
        () => { if (!socket.destroyed) socket.end(JSON.stringify({
          requestId: "unavailable", action: "hold", reason: "trusted_service_unavailable"
        }) + "\n"); }
      );
    });
    socket.on("error", () => {
      // Do not leak raw request data or certificate material.
      socket.destroy();
    });
  });
}
