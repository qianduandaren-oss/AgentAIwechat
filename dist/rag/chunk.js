export function chunkDocuments(documents) {
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
