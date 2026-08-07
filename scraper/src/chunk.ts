export interface ChunkOptions {
  size?: number;
  overlap?: number;
}

const DEFAULT_SIZE = 1000;
const DEFAULT_OVERLAP = 150;

// Sentence-level fallback for a single paragraph too long to fit in one
// chunk on its own (rare for small-business page content, but a long FAQ
// answer or service description can hit this).
function splitLongParagraph(paragraph: string, size: number): string[] {
  if (paragraph.length <= size) return [paragraph];

  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > size) {
      if (current) {
        parts.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += size) {
        parts.push(sentence.slice(i, i + size));
      }
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > size) {
      parts.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Greedily packs paragraphs into ~`size`-char chunks, carrying the tail of
// each chunk into the next as overlap so context isn't severed at a chunk
// boundary. Paragraph-aware: never splits a paragraph unless it alone
// exceeds `size` (splitLongParagraph handles that case at sentence granularity).
export function chunkText(paragraphs: string[], opts: ChunkOptions = {}): string[] {
  const size = opts.size ?? DEFAULT_SIZE;
  const overlap = opts.overlap ?? DEFAULT_OVERLAP;
  if (overlap >= size) {
    throw new Error(`chunk overlap (${overlap}) must be smaller than chunk size (${size})`);
  }

  const units = paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .flatMap((p) => splitLongParagraph(p, size));

  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length > size && current) {
      chunks.push(current);
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = `${tail}\n\n${unit}`.trim();
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}
