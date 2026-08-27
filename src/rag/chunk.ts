import type { KnowledgeDocument } from "./documents.js";

export type KnowledgeChunk = KnowledgeDocument & {
  chunkId: string;
};

export function chunkDocuments(documents: KnowledgeDocument[]): KnowledgeChunk[] {
  return documents.flatMap(document => {
    const parts = document.content
      .split(/[。！？]/)
      .map(part => part.trim())
      .filter(Boolean);

    return parts.map((content, index) => ({
      ...document,
      content,
      chunkId: `${document.id}#${index + 1}`
    }));
  });
}
