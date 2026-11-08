/**
 * Minimal Node.js built-in declarations for Day 74 SQLite delivery tests.
 * This repository intentionally uses small local shims instead of @types/node.
 */
declare module "node:assert" {
  export const strict: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(block: () => unknown, error?: ((error: unknown) => boolean) | RegExp): void;
    ok(value: unknown, message?: string): asserts value;
    rejects(block: Promise<unknown> | (() => Promise<unknown>), error?: ((error: unknown) => boolean) | RegExp): Promise<void>;
  };
}
declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:path" {
  export function join(...paths: string[]): string;
}
declare module "node:crypto" {
  export function randomUUID(): string;
}
