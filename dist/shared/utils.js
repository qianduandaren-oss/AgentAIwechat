export function createId(prefix = "id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
