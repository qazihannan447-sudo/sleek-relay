import { promises as fs } from "node:fs";
import path from "node:path";
import type { Chunk } from "./siteSchema.js";
import type { ChunkStore } from "./chunkStore.js";

export interface FileChunkStoreConfig {
  dataDir: string;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function fileFor(dataDir: string, tenantId: string, agentId: string): string {
  return path.join(dataDir, `${safeSegment(tenantId)}__${safeSegment(agentId)}.json`);
}

interface StoredFile {
  tenantId: string;
  agentId: string;
  savedAt: string;
  chunks: Chunk[];
}

// Durable local persistence: one JSON file per tenant+agent under
// `dataDir`. Not a production store — no concurrent-write safety, no
// querying beyond "everything for this tenant+agent" — but it survives
// process restarts, which InMemoryChunkStore deliberately does not, and
// implements the exact same ChunkStore interface so callers (approveSiteDraft,
// demoAsk.ts) don't change when this is eventually swapped for a real database.
export class FileChunkStore implements ChunkStore {
  constructor(private readonly config: FileChunkStoreConfig) {}

  async save(tenantId: string, agentId: string, chunks: Chunk[]): Promise<void> {
    await fs.mkdir(this.config.dataDir, { recursive: true });
    const record: StoredFile = { tenantId, agentId, savedAt: new Date().toISOString(), chunks };
    await fs.writeFile(fileFor(this.config.dataDir, tenantId, agentId), JSON.stringify(record, null, 2), "utf-8");
  }

  async deleteAll(tenantId: string, agentId: string): Promise<void> {
    await fs.rm(fileFor(this.config.dataDir, tenantId, agentId), { force: true });
  }

  async load(tenantId: string, agentId: string): Promise<Chunk[]> {
    try {
      const raw = await fs.readFile(fileFor(this.config.dataDir, tenantId, agentId), "utf-8");
      const parsed = JSON.parse(raw) as StoredFile;
      return parsed.chunks ?? [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }
}
