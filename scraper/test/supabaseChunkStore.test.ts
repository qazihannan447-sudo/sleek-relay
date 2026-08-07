import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseChunkStore } from "../src/supabaseChunkStore.js";
import type { Chunk } from "../src/siteSchema.js";

interface FakeCall {
  op: "delete" | "insert" | "select";
  table: string;
  filters: Array<[string, unknown]>;
  insertedRows?: unknown[];
  selectColumns?: string;
  orderColumn?: string;
}

interface FakeResponses {
  deleteError?: { message: string } | null;
  insertError?: { message: string } | null;
  selectData?: unknown[];
  selectError?: { message: string } | null;
}

// Supabase's query builder is "thenable" (awaiting it resolves to
// {data, error}) rather than returning a plain Promise from each chain
// method — this fake mirrors that shape closely enough for the three
// operations SupabaseChunkStore actually uses (delete/insert/select).
function createFakeSupabaseClient(responses: FakeResponses = {}) {
  const calls: FakeCall[] = [];

  function makeChain(op: FakeCall["op"], table: string, extra: Partial<FakeCall> = {}) {
    const call: FakeCall = { op, table, filters: [], ...extra };
    calls.push(call);

    const chain = {
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return chain;
      },
      order(column: string) {
        call.orderColumn = column;
        return chain;
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        const result =
          op === "delete"
            ? { error: responses.deleteError ?? null }
            : op === "insert"
              ? { error: responses.insertError ?? null }
              : { data: responses.selectData ?? [], error: responses.selectError ?? null };
        return Promise.resolve(result).then(onFulfilled, onRejected);
      }
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        delete: () => makeChain("delete", table),
        insert: (rows: unknown[]) => makeChain("insert", table, { insertedRows: rows }),
        select: (columns: string) => makeChain("select", table, { selectColumns: columns })
      };
    }
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function chunk(sourceUrl: string, text: string, chunkIndex = 0): Chunk {
  return { sourceUrl, pageType: "services", chunkIndex, text };
}

describe("SupabaseChunkStore", () => {
  it("save() deletes existing rows for the tenant+agent, then inserts the new ones", async () => {
    const { client, calls } = createFakeSupabaseClient();
    const store = new SupabaseChunkStore({ client, table: "agent_knowledge_chunks" });

    await store.save("tenant-a", "agent-1", [chunk("https://example.test/services", "We offer web design.")]);

    expect(calls[0]).toMatchObject({
      op: "delete",
      table: "agent_knowledge_chunks",
      filters: [
        ["tenant_id", "tenant-a"],
        ["agent_id", "agent-1"]
      ]
    });
    expect(calls[1]!.op).toBe("insert");
    expect(calls[1]!.insertedRows).toEqual([
      {
        tenant_id: "tenant-a",
        agent_id: "agent-1",
        source_url: "https://example.test/services",
        page_type: "services",
        chunk_index: 0,
        text: "We offer web design."
      }
    ]);
  });

  it("save() with an empty chunk list deletes but does not call insert", async () => {
    const { client, calls } = createFakeSupabaseClient();
    const store = new SupabaseChunkStore({ client });

    await store.save("tenant-a", "agent-1", []);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe("delete");
  });

  it("save() throws a descriptive error when the insert fails", async () => {
    const { client } = createFakeSupabaseClient({ insertError: { message: "duplicate key value" } });
    const store = new SupabaseChunkStore({ client });

    await expect(store.save("tenant-a", "agent-1", [chunk("https://example.test/", "x")])).rejects.toThrow(
      /duplicate key value/
    );
  });

  it("deleteAll() filters by tenant and agent", async () => {
    const { client, calls } = createFakeSupabaseClient();
    const store = new SupabaseChunkStore({ client });

    await store.deleteAll("tenant-a", "agent-1");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      op: "delete",
      filters: [
        ["tenant_id", "tenant-a"],
        ["agent_id", "agent-1"]
      ]
    });
  });

  it("load() selects, filters, orders by chunk_index, and maps rows back to Chunk shape", async () => {
    const selectData = [
      { source_url: "https://example.test/a", page_type: "services", chunk_index: 0, text: "first" },
      { source_url: "https://example.test/a", page_type: "services", chunk_index: 1, text: "second" }
    ];
    const { client, calls } = createFakeSupabaseClient({ selectData });
    const store = new SupabaseChunkStore({ client });

    const result = await store.load("tenant-a", "agent-1");

    expect(result).toEqual([
      { sourceUrl: "https://example.test/a", pageType: "services", chunkIndex: 0, text: "first" },
      { sourceUrl: "https://example.test/a", pageType: "services", chunkIndex: 1, text: "second" }
    ]);
    expect(calls[0]).toMatchObject({ op: "select", orderColumn: "chunk_index" });
  });

  it("load() returns an empty array when nothing is stored", async () => {
    const { client } = createFakeSupabaseClient({ selectData: [] });
    const store = new SupabaseChunkStore({ client });
    expect(await store.load("tenant-a", "agent-1")).toEqual([]);
  });

  it("load() throws a descriptive error when the query fails", async () => {
    const { client } = createFakeSupabaseClient({ selectError: { message: "relation does not exist" } });
    const store = new SupabaseChunkStore({ client });

    await expect(store.load("tenant-a", "agent-1")).rejects.toThrow(/relation does not exist/);
  });

  it("uses the configured table name instead of the default", async () => {
    const { client, calls } = createFakeSupabaseClient();
    const store = new SupabaseChunkStore({ client, table: "custom_chunks_table" });

    await store.deleteAll("tenant-a", "agent-1");

    expect(calls[0]!.table).toBe("custom_chunks_table");
  });
});
