-- Table expected by src/supabaseChunkStore.ts. Copy into the parent app's
-- Supabase migrations (this package doesn't run migrations itself — it has
-- no connection details or migration tooling for the parent project).
--
-- tenant_id/agent_id are `text` here because ChunkStore's interface treats
-- them as plain strings throughout this package. If the parent app's
-- tenant/agent tables use uuid primary keys, change these to `uuid` and add
-- foreign keys (REFERENCES tenants(id), REFERENCES agents(id)) instead.
--
-- `embedding` is included but unpopulated by this package — embedding
-- generation is a deliberately separate concern (see embedder.ts / demoAsk.ts),
-- left for whatever ingestion step runs after approveSiteDraft() to fill in.
-- Requires the pgvector extension: `create extension if not exists vector;`

create table if not exists agent_knowledge_chunks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null,
  agent_id     text not null,
  source_url   text not null,
  page_type    text not null,
  chunk_index  int not null,
  text         text not null,
  embedding    vector(3072), -- matches gemini-embedding-2's default output size; adjust to your chosen model
  created_at   timestamptz not null default now(),
  unique (tenant_id, agent_id, source_url, chunk_index)
);

create index if not exists agent_knowledge_chunks_tenant_agent_idx
  on agent_knowledge_chunks (tenant_id, agent_id);

-- Only needed once embeddings are actually populated:
-- create index if not exists agent_knowledge_chunks_embedding_idx
--   on agent_knowledge_chunks using ivfflat (embedding vector_cosine_ops);
