import type { Chunk } from "./siteSchema.js";

// Real persistence: SupabaseChunkStore (supabaseChunkStore.ts), table
// defined in supabase/agent_knowledge_chunks.sql. Local dev/testing only:
// FileChunkStore (fileChunkStore.ts, durable across process restarts) and
// InMemoryChunkStore below (not durable at all).

export interface ChunkStore {
  save(tenantId: string, agentId: string, chunks: Chunk[]): Promise<void>;
  deleteAll(tenantId: string, agentId: string): Promise<void>;
  load(tenantId: string, agentId: string): Promise<Chunk[]>;
}

// Reference implementation for tests/demos — not for production use, and
// not durable: data lives only as long as this process does. For
// persistence across runs see FileChunkStore (fileChunkStore.ts). Real
// production persistence (Postgres+pgvector, etc.) implements the same interface.
export class InMemoryChunkStore implements ChunkStore {
  private readonly store = new Map<string, Chunk[]>();

  private key(tenantId: string, agentId: string): string {
    return `${tenantId}::${agentId}`;
  }

  async save(tenantId: string, agentId: string, chunks: Chunk[]): Promise<void> {
    this.store.set(this.key(tenantId, agentId), chunks);
  }

  async deleteAll(tenantId: string, agentId: string): Promise<void> {
    this.store.delete(this.key(tenantId, agentId));
  }

  async load(tenantId: string, agentId: string): Promise<Chunk[]> {
    return this.store.get(this.key(tenantId, agentId)) ?? [];
  }
}
