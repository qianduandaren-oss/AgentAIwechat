import { embedding } from "./embedding.js";
import { cosineSimilarity } from "./similarity.js";
export async function buildIndex(chunks) {
    return Promise.all(chunks.map(async (chunk) => ({
        ...chunk,
        vector: await embedding(`${chunk.title} ${chunk.content}`)
    })));
}
function domainBoost(query, chunk) {
    const source = `${chunk.title} ${chunk.content}`;
    if (/退费|退款|退钱|钱还能退|钱能退/.test(query) && /退费/.test(source))
        return 0.45;
    if (/就业|找工作/.test(query) && /就业/.test(source))
        return 0.35;
    return 0;
}
export async function retrieve(query, index, options = {}) {
    const { topK = 3, minScore = 0.08, year = 2026 } = options;
    const queryVector = await embedding(query);
    return index
        .filter(chunk => chunk.year === year)
        .map(chunk => ({
        ...chunk,
        score: cosineSimilarity(queryVector, chunk.vector) + domainBoost(query, chunk)
    }))
        .filter(chunk => chunk.score >= minScore)
        .sort((a, b) => {
        const authorityDiff = b.authority - a.authority;
        return Math.abs(authorityDiff) > 0.2 ? authorityDiff : b.score - a.score;
    })
        .slice(0, topK)
        .map(({ vector: _vector, ...chunk }) => chunk);
}
