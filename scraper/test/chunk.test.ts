import { describe, expect, it } from "vitest";
import { chunkText } from "../src/chunk.js";

describe("chunkText", () => {
  it("returns a single chunk when total content fits within size", () => {
    const chunks = chunkText(["First paragraph.", "Second paragraph."], { size: 1000, overlap: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("First paragraph.");
    expect(chunks[0]).toContain("Second paragraph.");
  });

  it("splits into multiple chunks once content exceeds size, respecting paragraph boundaries", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph number ${i} with some filler text to add length.`);
    const chunks = chunkText(paragraphs, { size: 200, overlap: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200 + 30); // allows for the carried-over overlap tail
    }
  });

  it("carries an overlap tail from the previous chunk into the next", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i}. `.repeat(5));
    const chunks = chunkText(paragraphs, { size: 150, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    const tailOfFirst = chunks[0]!.slice(-20);
    expect(chunks[1]).toContain(tailOfFirst.trim().split(" ").slice(-2).join(" "));
  });

  it("hard-splits a single paragraph longer than the chunk size", () => {
    const longParagraph = "word ".repeat(500); // ~2500 chars, no sentence punctuation
    const chunks = chunkText([longParagraph], { size: 300, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("throws when overlap is not smaller than size", () => {
    expect(() => chunkText(["text"], { size: 100, overlap: 100 })).toThrow(/overlap/);
  });

  it("drops empty/whitespace-only paragraphs", () => {
    const chunks = chunkText(["", "  ", "Real content."], { size: 100, overlap: 10 });
    expect(chunks).toEqual(["Real content."]);
  });
});
