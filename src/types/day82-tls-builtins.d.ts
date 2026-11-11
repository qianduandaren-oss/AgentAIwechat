/** Minimal Node TLS declarations, consistent with the existing repository shims. */
declare module "node:tls" {
  export class TLSSocket {
    readonly authorized: boolean;
    readonly encrypted: boolean;
    readonly destroyed: boolean;
    getPeerCertificate(detailed?: boolean): { fingerprint256?: string };
    setEncoding(encoding: string): this;
    setTimeout(timeout: number, callback: () => void): this;
    on(event: "data", callback: (chunk: string) => void): this;
    on(event: "error", callback: (error: unknown) => void): this;
    end(data?: string): this;
    destroy(): this;
  }
  export interface Server {
    listen(port: number, host: string, callback?: () => void): this;
    address(): string | { port: number } | null;
    close(callback?: (error?: Error) => void): this;
    on(event: "error", callback: (error: Error) => void): this;
  }
  export function createServer(
    options: {
      key: string; cert: string; ca: string;
      requestCert: boolean; rejectUnauthorized: boolean; minVersion: "TLSv1.3";
    },
    onSecureConnection: (socket: TLSSocket) => void
  ): Server;
}
