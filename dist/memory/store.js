export class MemoryStore {
    data = new Map();
    save(userId, candidate) {
        let user = this.data.get(userId);
        if (!user) {
            user = new Map();
            this.data.set(userId, user);
        }
        const existing = user.get(candidate.key);
        const now = new Date().toISOString();
        const value = {
            ...candidate,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
        };
        user.set(candidate.key, value);
        return value;
    }
    list(userId) {
        return [...(this.data.get(userId)?.values() ?? [])];
    }
}
