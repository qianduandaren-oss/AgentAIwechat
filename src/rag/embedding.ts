const DIMENSIONS = 96;

function canonicalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/退钱|退款|退课|钱还能退|钱能退|退费/g, "退费")
    .replace(/找工作|工作岗位|就业/g, "就业")
    .replace(/课程学习|上课|学习/g, "学习")
    .replace(/\s+/g, "");
}

function hash(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function tokens(text: string): string[] {
  const value = canonicalize(text);
  const output = new Set<string>();

  for (const keyword of ["退费", "就业", "PLC", "课程", "协议", "报名", "提醒"]) {
    if (value.includes(keyword.toLowerCase())) output.add(keyword.toLowerCase());
  }

  for (let i = 0; i < value.length - 1; i++) {
    output.add(value.slice(i, i + 2));
  }
  return [...output];
}

/**
 * 教学用本地 Embedding：用 token hashing 生成固定维度向量。
 * 生产环境应替换为真实 embedding model，但 Retriever / cosine 层无需改动。
 */
export async function embedding(text: string): Promise<number[]> {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const token of tokens(text)) {
    const index = hash(token) % DIMENSIONS;
    vector[index] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0));
  return norm === 0 ? vector : vector.map(n => n / norm);
}
