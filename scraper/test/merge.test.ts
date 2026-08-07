import { describe, expect, it } from "vitest";
import { accumulateListField } from "../src/merge.js";
import type { Field } from "../src/schema.js";

function field<T>(value: T, source: Field<T>["source"] = "structured_data", confidence: Field<T>["confidence"] = "high"): Field<T> {
  return { value, source, sourceUrl: "https://example.test/", confidence };
}

describe("accumulateListField", () => {
  it("returns undefined for an empty candidate list", () => {
    expect(accumulateListField([], (s: string) => s)).toBeUndefined();
  });

  it("concatenates items from multiple pages", () => {
    const a = field([{ name: "Web Design" }], "structured_data", "high");
    const b = field([{ name: "SEO" }], "llm_inferred", "medium");
    const merged = accumulateListField([a, b], (item: { name: string }) => item.name);
    expect(merged?.value).toEqual([{ name: "Web Design" }, { name: "SEO" }]);
  });

  it("de-dupes items with the same key (case-insensitive), keeping the first occurrence", () => {
    const overview = field([{ name: "Web Design" }, { name: "SEO" }], "structured_data", "high");
    const detailPage = field([{ name: "web design" }, { name: "Branding" }], "llm_inferred", "medium");
    const merged = accumulateListField([overview, detailPage], (item: { name: string }) => item.name);
    expect(merged?.value.map((i) => i.name)).toEqual(["Web Design", "SEO", "Branding"]);
  });

  it("picks the highest-ranked source and confidence across contributors", () => {
    const low = field(["a"], "llm_inferred", "low");
    const high = field(["b"], "structured_data", "high");
    const merged = accumulateListField([low, high], (s: string) => s);
    expect(merged?.source).toBe("structured_data");
    expect(merged?.confidence).toBe("high");
  });

  it("supports plain-string items (e.g. socialLinks) via an identity key extractor", () => {
    const a = field(["https://facebook.com/x"], "structured_data", "high");
    const b = field(["https://facebook.com/x", "https://instagram.com/x"], "llm_inferred", "medium");
    const merged = accumulateListField([a, b], (s: string) => s);
    expect(merged?.value).toEqual(["https://facebook.com/x", "https://instagram.com/x"]);
  });

  // Regression: a real Gemini run returned a faqs item that didn't match
  // the expected {question, answer} shape, and accumulateListField crashed
  // calling .trim() on undefined instead of dropping the malformed item —
  // items here are raw, not-yet-schema-validated LLM output (validation
  // runs after merge), so this must never throw regardless of shape.
  it("drops malformed items (missing expected key) instead of throwing", () => {
    const wellFormed = field([{ question: "Do you ship internationally?", answer: "Yes." }], "llm_inferred", "low");
    const malformed = field(
      [{ notQuestion: "oops" }, null, "just a string", { question: "Real one?", answer: "Yep." }] as unknown as Array<{
        question: string;
      }>,
      "llm_inferred",
      "low"
    );
    const merged = accumulateListField([wellFormed, malformed], (item: { question: string }) => item.question);
    expect(merged?.value).toEqual([
      { question: "Do you ship internationally?", answer: "Yes." },
      { question: "Real one?", answer: "Yep." }
    ]);
  });
});
