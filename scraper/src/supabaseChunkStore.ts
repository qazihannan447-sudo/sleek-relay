import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Chunk, PageType } from "./siteSchema.js";
import type { ChunkStore } from "./chunkStore.js";

const DEFAULT_TABLE = "agent_knowledge_chunks";

interface ChunkRow {
  tenant_id: string;
  agent_id: string;
  source_url: string;
  page_type: string;
  chunk_index: number;
  text: string;
}

function toRow(tenantId: string, agentId: string, chunk: Chunk): ChunkRow {
  return {
    tenant_id: tenantId,
    agent_id: agentId,
    source_url: chunk.sourceUrl,
    page_type: chunk.pageType,
    chunk_index: chunk.chunkIndex,
    text: chunk.text
  };
}

function fromRow(row: ChunkRow): Chunk {
  return {
    sourceUrl: row.source_url,
    pageType: row.page_type as PageType,
    chunkIndex: row.chunk_index,
    text: row.text
  };
}

export interface SupabaseChunkStoreOptions {
  client: SupabaseClient;
  table?: string;
}

// Production-shaped ChunkStore backed by Supabase Postgres — the actual DB
// choice for this project (per the parent app's current architecture),
// distinct from FileChunkStore (local dev) and InMemoryChunkStore (tests).
// See supabase/agent_knowledge_chunks.sql for the table this expects.
//
// save() overwrites: delete-then-insert per tenant+agent, same "re-scan
// replaces the previous draft's chunks" semantics as FileChunkStore. This
// is two separate statements, not one transaction — a real production
// hardening pass could move this into a Postgres function called via
// `.rpc()` for atomicity, but delete-then-insert is enough for this
// component's scope (single-writer-at-a-time per tenant+agent, driven by
// one owner's approve action).
export class SupabaseChunkStore implements ChunkStore {
  private readonly client: SupabaseClient;
  private readonly table: string;

  constructor(options: SupabaseChunkStoreOptions) {
    this.client = options.client;
    this.table = options.table ?? DEFAULT_TABLE;
  }

  async save(tenantId: string, agentId: string, chunks: Chunk[]): Promise<void> {
    await this.deleteAll(tenantId, agentId);
    if (chunks.length === 0) return;

    const rows = chunks.map((chunk) => toRow(tenantId, agentId, chunk));
    const { error } = await this.client.from(this.table).insert(rows);
    if (error) {
      throw new Error(`SupabaseChunkStore.save failed: ${error.message}`);
    }
  }

  async deleteAll(tenantId: string, agentId: string): Promise<void> {
    const { error } = await this.client.from(this.table).delete().eq("tenant_id", tenantId).eq("agent_id", agentId);
    if (error) {
      throw new Error(`SupabaseChunkStore.deleteAll failed: ${error.message}`);
    }
  }

  async load(tenantId: string, agentId: string): Promise<Chunk[]> {
    const { data, error } = await this.client
      .from(this.table)
      .select("source_url, page_type, chunk_index, text")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agentId)
      .order("chunk_index", { ascending: true });
    if (error) {
      throw new Error(`SupabaseChunkStore.load failed: ${error.message}`);
    }
    return ((data ?? []) as ChunkRow[]).map(fromRow);
  }
}

export interface SupabaseChunkStoreConfig {
  url: string;
  serviceRoleKey: string;
  table?: string;
}

// Uses the service role key deliberately — this store is written to by a
// backend worker (per the extraction pipeline's own trust boundary, not an
// end-user session), so it needs to bypass row-level security the way any
// other server-side write path into this table would.
export function loadSupabaseChunkStoreConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseChunkStoreConfig {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return { url, serviceRoleKey, table: env.SUPABASE_CHUNKS_TABLE };
}

export function createSupabaseChunkStore(config: SupabaseChunkStoreConfig): SupabaseChunkStore {
  const client = createClient(config.url, config.serviceRoleKey);
  return new SupabaseChunkStore({ client, table: config.table });
}
