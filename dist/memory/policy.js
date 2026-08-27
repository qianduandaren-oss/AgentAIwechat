export function shouldSaveMemory(candidate) {
    if (candidate.confidence < 0.8)
        return false;
    if (candidate.source === "user_inferred" && candidate.confidence < 0.9)
        return false;
    return ["identity", "preference", "interest", "objection"].includes(candidate.type);
}
