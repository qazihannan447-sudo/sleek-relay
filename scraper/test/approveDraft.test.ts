import { describe, expect, it } from "vitest";
import { approveDraft } from "../src/approveDraft.js";
import { extractDraft } from "../src/extractDraft.js";
import { ALLOW_ALL_ROBOTS_TXT, mockFetch, textResponse } from "./helpers.js";

const SITE = "https://example.test";
const ROBOTS_URL = `${SITE}/robots.txt`;
const HTML = `<html><head>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Example Co","telephone":"555-000-1111"}</script>
</head><body></body></html>`;

describe("approveDraft — the only path to an activatable record", () => {
  it("requires approvedBy and approvedAt, and stamps the approval", async () => {
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse(ALLOW_ALL_ROBOTS_TXT),
      [`${SITE}/`]: () => textResponse(HTML)
    });
    const draft = await extractDraft(SITE, { fetchImpl });

    expect(() => approveDraft(draft, "", new Date())).toThrow(/approvedBy/);
    expect(() => approveDraft(draft, "owner@example.test", new Date("not-a-date"))).toThrow(/approvedAt/);

    const approvedAt = new Date("2026-08-06T12:00:00Z");
    const approved = approveDraft(draft, "owner@example.test", approvedAt);

    expect(approved.approvedBy).toBe("owner@example.test");
    expect(approved.approvedAt).toBe(approvedAt.toISOString());
    expect(approved.fields.businessName).toBe("Example Co");
  });

  it("extractDraft's return type carries no approval fields — extraction and activation are separate functions", async () => {
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse(ALLOW_ALL_ROBOTS_TXT),
      [`${SITE}/`]: () => textResponse(HTML)
    });
    const draft = await extractDraft(SITE, { fetchImpl });

    expect(draft).not.toHaveProperty("approvedBy");
    expect(draft).not.toHaveProperty("approvedAt");
  });
});
