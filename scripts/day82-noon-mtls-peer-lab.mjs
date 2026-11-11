/**
 * Day 82 noon — disposable localhost mTLS handshake + verified-identity lab.
 * Requires Node 22 and openssl. All keys/certificates are generated under a
 * temporary folder, never committed, and deleted when the test finishes.
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:tls";
import { createRecoveryWriterMtlsCandidateServer } from "../dist/runtime/recovery-writer-mtls-transport.js";
import { RecoveryWriterRpcCandidateHandler } from "../dist/runtime/recovery-writer-rpc-handler.js";
import { RecoveryWriterRpcAdmissionHandler } from "../dist/runtime/recovery-writer-rpc-admission.js";

const dir = mkdtempSync(join(tmpdir(), "day82-mtls-"));
const file = name => join(dir, name);
function openssl(...args) {
  execFileSync("openssl", args, { stdio: "ignore", timeout: 15_000 });
}
function makeCert(name, extendedKeyUsage, subjectAltName = "") {
  const key = file(name + "-key.pem");
  const csr = file(name + ".csr");
  const cert = file(name + "-cert.pem");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", key,
    "-out", csr, "-subj", "/CN=" + name);
  const ext = file(name + ".ext");
  writeFileSync(ext, "extendedKeyUsage=" + extendedKeyUsage + "\n" +
    (subjectAltName ? "subjectAltName=" + subjectAltName + "\n" : ""));
  openssl("x509", "-req", "-in", csr, "-CA", file("ca-cert.pem"),
    "-CAkey", file("ca-key.pem"), "-CAcreateserial",
    "-out", cert, "-days", "1", "-sha256", "-extfile", ext);
  return { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
}
let server;
try {
  openssl("req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
    "-keyout", file("ca-key.pem"), "-out", file("ca-cert.pem"),
    "-days", "1", "-subj", "/CN=Day82-Disposable-CA",
    "-addext", "basicConstraints=critical,CA:TRUE");
  const ca = readFileSync(file("ca-cert.pem"), "utf8");
  const srv = makeCert("localhost", "serverAuth", "DNS:localhost");
  const claim = makeCert("claim-worker", "clientAuth");
  const confirm = makeCert("confirm-worker", "clientAuth");
  const unregistered = makeCert("unregistered-worker", "clientAuth");
  const fingerprint = pem => new X509Certificate(pem).fingerprint256;
  const granted = new Map([
    ["svc:claim-day82", true],
    ["svc:confirm-day82", true]
  ]);
  const actions = [];
  const audits = [];
  const service = {
    async claimOutbox({ outboxId }) {
      actions.push(["claim", outboxId]);
      return { action: "claimed", eventId: "event:82", leaseToken: "lease:82" };
    },
    async confirmOutbox({ rawConsumerResponse }) {
      actions.push(["confirm", rawConsumerResponse]);
      // Only a disposable test stub, NOT a production Consumer ACK verifier.
      return rawConsumerResponse?.proof === "verified-in-test"
        ? { action: "dispatched", eventId: "event:82" }
        : { action: "hold", reason: "consumer_authentication_failed" };
    }
  };
  const handler = new RecoveryWriterRpcAdmissionHandler(
    new RecoveryWriterRpcCandidateHandler(service),
    {
      reauthorize: async (caller, operation) =>
        granted.get(caller.subject) === true &&
        caller.grantedOperations.includes(operation),
      recordAudit: event => audits.push(event),
      nowEpochMs: () => Date.now(),
      maxInFlightPerSubject: 2, replayTtlMs: 30_000, maxReplayKeys: 32
    }
  );
  server = createRecoveryWriterMtlsCandidateServer({
    keyPem: srv.key, certPem: srv.cert, clientCaPem: ca,
    peers: [
      { fingerprint256: fingerprint(claim.cert),
        subject: "svc:claim-day82", grantedOperations: ["claim_outbox"] },
      { fingerprint256: fingerprint(confirm.cert),
        subject: "svc:confirm-day82", grantedOperations: ["confirm_outbox"] }
    ],
    handler,
    requestTimeoutMs: 5_000
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  async function send(identity, body) {
    return new Promise(resolve => {
      let result = "";
      const client = connect({
        host: "127.0.0.1", port, servername: "localhost",
        ca, rejectUnauthorized: true,
        ...(identity || {})
      }, () => client.write(JSON.stringify(body) + "\n"));
      client.setEncoding("utf8");
      client.setTimeout(6_000, () => client.destroy());
      client.on("data", chunk => { result += chunk; });
      client.on("error", () => {}); // Handshake refusals are expected.
      client.on("close", () => {
        if (!result.endsWith("\n")) return resolve(null);
        try { resolve(JSON.parse(result.trim())); } catch { resolve(null); }
      });
    });
  }
  const request = (requestId, operation) =>
    ({ requestId, operation, outboxId: "cmd:82" });
  const first = await send(claim, request("req82claim", "claim_outbox"));
  assert.equal(first?.action, "claimed");
  assert.equal(actions.length, 1);

  // Same authenticated certificate, but no authorization for confirmation.
  const denied = await send(claim, {
    ...request("req82wrong-op", "confirm_outbox"),
    eventId: "event:82", leaseToken: "lease:82",
    rawConsumerResponse: { proof: "verified-in-test" }
  });
  assert.equal(denied?.action, "hold");
  assert.equal(denied?.reason, "transport_identity_or_permission_denied");
  assert.equal(actions.length, 1);

  // A client cannot smuggle a subject or epoch through its JSON body.
  const forgery = await send(confirm, {
    ...request("req82forged", "claim_outbox"),
    subject: "svc:confirm-day82", epoch: 999
  });
  assert.equal(forgery?.reason, "unexpected_or_missing_field");
  assert.equal(actions.length, 1);

  // CA-signed but unregistered cert: TLS handshake succeeds, pinning rejects it.
  assert.equal(await send(unregistered, request("req82unknown", "claim_outbox")), null);
  assert.equal(actions.length, 1);

  // No client certificate: TLS handshake cannot authenticate the peer.
  assert.equal(await send(null, request("req82anonymous", "claim_outbox")), null);
  assert.equal(actions.length, 1);

  // A registered certificate is not sufficient after server-side ACL revocation.
  granted.set("svc:confirm-day82", false);
  const revoked = await send(confirm, {
    ...request("req82revoked", "confirm_outbox"),
    eventId: "event:82", leaseToken: "lease:82",
    rawConsumerResponse: { proof: "verified-in-test" }
  });
  assert.equal(revoked?.reason, "authorization_revoked");
  assert.equal(actions.length, 1);

  granted.set("svc:confirm-day82", true);
  const ackDenied = await send(confirm, {
    ...request("req82badack", "confirm_outbox"),
    eventId: "event:82", leaseToken: "lease:82",
    rawConsumerResponse: { proof: "client-claims-success" }
  });
  assert.equal(ackDenied?.reason, "consumer_authentication_failed");
  const ackOk = await send(confirm, {
    ...request("req82goodack", "confirm_outbox"),
    eventId: "event:82", leaseToken: "lease:82",
    rawConsumerResponse: { proof: "verified-in-test" }
  });
  assert.equal(ackOk?.action, "dispatched");
  assert.equal(actions.length, 3);
  assert.ok(audits.every(x => !("rawConsumerResponse" in x) && !("leaseToken" in x)));
  console.log("PASS Day 82 real localhost mTLS handshake, pinned identity, ACL revocation and spoof denial");
} finally {
  if (server) await new Promise(resolve => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
}
