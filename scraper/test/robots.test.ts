import { describe, expect, it } from "vitest";
import { isAllowedByRobots } from "../src/robots.js";
import { disallowRobotsTxt, mockFetch, textResponse, notFoundResponse } from "./helpers.js";

const SITE = "https://example.test";
const ROBOTS_URL = `${SITE}/robots.txt`;

describe("isAllowedByRobots", () => {
  it("returns false for a path robots.txt explicitly disallows", async () => {
    const fetchImpl = mockFetch({ [ROBOTS_URL]: () => textResponse(disallowRobotsTxt("/private")) });
    const allowed = await isAllowedByRobots(`${SITE}/private`, { userAgent: "TestBot/1.0", fetchImpl });
    expect(allowed).toBe(false);
  });

  it("returns true for a path not covered by any Disallow rule", async () => {
    const fetchImpl = mockFetch({ [ROBOTS_URL]: () => textResponse(disallowRobotsTxt("/private")) });
    const allowed = await isAllowedByRobots(`${SITE}/about`, { userAgent: "TestBot/1.0", fetchImpl });
    expect(allowed).toBe(true);
  });

  it("fails open (allows) when robots.txt itself is unreachable", async () => {
    const fetchImpl = mockFetch({ [ROBOTS_URL]: () => notFoundResponse() });
    const allowed = await isAllowedByRobots(`${SITE}/anything`, { userAgent: "TestBot/1.0", fetchImpl });
    expect(allowed).toBe(true);
  });
});
