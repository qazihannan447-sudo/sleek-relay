import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileChunkStore } from "../src/fileChunkStore.js";
import type { Chunk } from "../src/siteSchema.js";

function chunk(sourceUrl: string, text: string, chunkIndex = 0): Chunk {
  return { sourceUrl, pageType: "services", chunkIndex, text };
}

describe("FileChunkStore", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunkstore-test-"));
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("returns an empty array when nothing has been saved yet", async () => {
    const store = new FileChunkStore({ dataDir });
    expect(await store.load("tenant-a", "agent-1")).toEqual([]);
  });

  it("saves and loads chunks for a tenant+agent", async () => {
    const store = new FileChunkStore({ dataDir });
    const chunks = [chunk("https://example.test/services", "We offer web design.")];

    await store.save("tenant-a", "agent-1", chunks);
    expect(await store.load("tenant-a", "agent-1")).toEqual(chunks);
  });

  it("survives across separate store instances (i.e. across a process restart)", async () => {
    const chunks = [chunk("https://example.test/services", "We offer web design.")];
    await new FileChunkStore({ dataDir }).save("tenant-a", "agent-1", chunks);

    // A brand new instance, same dataDir — simulates a fresh process reading
    // back what a previous run persisted.
    const reopened = new FileChunkStore({ dataDir });
    expect(await reopened.load("tenant-a", "agent-1")).toEqual(chunks);
  });

  it("keeps different tenant+agent pairs isolated", async () => {
    const store = new FileChunkStore({ dataDir });
    await store.save("tenant-a", "agent-1", [chunk("https://a.test/", "a")]);
    await store.save("tenant-b", "agent-1", [chunk("https://b.test/", "b")]);

    expect(await store.load("tenant-a", "agent-1")).toEqual([chunk("https://a.test/", "a")]);
    expect(await store.load("tenant-b", "agent-1")).toEqual([chunk("https://b.test/", "b")]);
  });

  it("save() overwrites any previous chunks for the same tenant+agent (re-scan behavior)", async () => {
    const store = new FileChunkStore({ dataDir });
    await store.save("tenant-a", "agent-1", [chunk("https://example.test/old", "old content")]);
    await store.save("tenant-a", "agent-1", [chunk("https://example.test/new", "new content")]);

    expect(await store.load("tenant-a", "agent-1")).toEqual([chunk("https://example.test/new", "new content")]);
  });

  it("deleteAll removes the stored chunks", async () => {
    const store = new FileChunkStore({ dataDir });
    await store.save("tenant-a", "agent-1", [chunk("https://example.test/", "x")]);
    await store.deleteAll("tenant-a", "agent-1");

    expect(await store.load("tenant-a", "agent-1")).toEqual([]);
  });

  it("deleteAll on a never-saved tenant+agent does not throw", async () => {
    const store = new FileChunkStore({ dataDir });
    await expect(store.deleteAll("never-saved", "agent-1")).resolves.toBeUndefined();
  });

  it("creates the data directory if it doesn't exist yet", async () => {
    const nestedDir = path.join(dataDir, "nested", "path");
    const store = new FileChunkStore({ dataDir: nestedDir });

    await store.save("tenant-a", "agent-1", [chunk("https://example.test/", "x")]);
    expect(await store.load("tenant-a", "agent-1")).toHaveLength(1);
  });
});
