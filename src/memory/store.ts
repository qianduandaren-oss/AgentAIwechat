import type { MemoryCandidate, MemoryValue } from "./types.js";

export class MemoryStore {
  private readonly data = new Map<string, Map<string, MemoryValue>>();

  save(userId: string, candidate: MemoryCandidate): MemoryValue {
    let user = this.data.get(userId);
    if (!user) {
      user = new Map();
      this.data.set(userId, user);
    }

    const existing = user.get(candidate.key);
    const now = new Date().toISOString();
    const value: MemoryValue = {
      ...candidate,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    user.set(candidate.key, value);
    return value;
  }

  list(userId: string): MemoryValue[] {
    return [...(this.data.get(userId)?.values() ?? [])];
  }
}
