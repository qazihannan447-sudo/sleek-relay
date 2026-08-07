import { describe, expect, it } from "vitest";
import { classifyPage } from "../src/pageTypes.js";

describe("classifyPage", () => {
  it("classifies the homepage", () => {
    expect(classifyPage("https://example.test/")).toBe("home");
  });

  it("classifies common page types by URL path", () => {
    expect(classifyPage("https://example.test/about-us")).toBe("about");
    expect(classifyPage("https://example.test/services")).toBe("services");
    expect(classifyPage("https://example.test/portfolio")).toBe("projects");
    expect(classifyPage("https://example.test/our-partners")).toBe("partners");
    expect(classifyPage("https://example.test/faq")).toBe("faq");
    expect(classifyPage("https://example.test/contact-us")).toBe("contact");
  });

  it("falls back to link text when the URL path is uninformative", () => {
    expect(classifyPage("https://example.test/p/123", "Frequently Asked Questions")).toBe("faq");
  });

  it("returns ambiguous when neither URL nor link text match a known pattern", () => {
    expect(classifyPage("https://example.test/p/123", "Learn More")).toBe("ambiguous");
  });

  it("classifies login/cart/account paths as ignore", () => {
    expect(classifyPage("https://example.test/login")).toBe("ignore");
    expect(classifyPage("https://example.test/cart")).toBe("ignore");
    expect(classifyPage("https://example.test/wp-admin")).toBe("ignore");
  });

  it("classifies non-HTML resources and social links as ignore", () => {
    expect(classifyPage("https://example.test/logo.png")).toBe("ignore");
    expect(classifyPage("https://example.test/brochure.pdf")).toBe("ignore");
    expect(classifyPage("https://www.facebook.com/example")).toBe("ignore");
  });

  it("returns ignore for an unparseable URL rather than throwing", () => {
    expect(classifyPage("not a url")).toBe("ignore");
  });
});
