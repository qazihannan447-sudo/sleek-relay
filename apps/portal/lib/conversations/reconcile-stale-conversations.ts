import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../supabase/admin';
import { browserConversationSource } from '../voice/start-conversation';
import type { ConversationStatus } from './helpers';

/** `starting` rows older than this never connected and can be discarded. */
export const STALE_STARTING_CONVERSATION_MS = 2 * 60 * 1000;
/** `active` rows older than this are treated as orphaned after disconnect. */
export const STALE_ACTIVE_CONVERSATION_MS = 5 * 60 * 1000;

type StaleConversationRow = {
  id: string;
  started_at: string;
  status: Extract<ConversationStatus, 'active' | 'starting'>;
};

type ReconcileStaleConversationsDeps = {
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  now: () => Date;
};

function buildActiveTerminalUpdate(args: {
  now: Date;
  row: StaleConversationRow;
}): {
  duration_ms: number;
  end_reason: string;
  ended_at: string;
  error_code: null;
  error_message: null;
  outcome: string;
  status: 'completed';
  summary: string;
} {
  const endedAt = args.now.toISOString();
  const durationMs = Math.max(
    0,
    args.now.getTime() - new Date(args.row.started_at).getTime(),
  );

  return {
    duration_ms: durationMs,
    end_reason: 'stale_session',
    ended_at: endedAt,
    error_code: null,
    error_message: null,
    outcome: 'Completed',
    status: 'completed',
    summary:
      'Browser voice test completed after the live connection ended without a clean client finalize.',
  };
}

function isStaleRow(row: StaleConversationRow, now: Date): boolean {
  const ageMs = now.getTime() - new Date(row.started_at).getTime();
  if (row.status === 'starting') {
    return ageMs >= STALE_STARTING_CONVERSATION_MS;
  }

  return ageMs >= STALE_ACTIVE_CONVERSATION_MS;
}

export function createReconcileStaleConversationsService(
  deps: ReconcileStaleConversationsDeps,
) {
  return async function reconcileStaleConversations(args: {
    tenantId: string;
  }): Promise<number> {
    try {
      deps.getSupabaseAdminEnv();
      const supabase = await deps.createServerSupabaseAdminClient();
      const now = deps.now();
      // Fetch any open row that could be stale under either threshold.
      const oldestCandidate = new Date(
        now.getTime() - STALE_STARTING_CONVERSATION_MS,
      ).toISOString();

      const { data, error } = await supabase
        .from('conversations')
        .select('id, status, started_at')
        .eq('tenant_id', args.tenantId)
        .eq('source', browserConversationSource)
        .in('status', ['starting', 'active'])
        .lt('started_at', oldestCandidate)
        .limit(100);

      if (error || !data || data.length === 0) {
        return 0;
      }

      let finalizedCount = 0;

      for (const row of data as StaleConversationRow[]) {
        if (!isStaleRow(row, now)) {
          continue;
        }

        if (row.status === 'starting') {
          // Never-connected warmup reservations should not appear in the tab.
          const { data: deleted, error: deleteError } = await supabase
            .from('conversations')
            .delete()
            .eq('tenant_id', args.tenantId)
            .eq('id', row.id)
            .eq('source', browserConversationSource)
            .eq('status', 'starting')
            .select('id')
            .maybeSingle();

          if (!deleteError && deleted) {
            finalizedCount += 1;
          }
          continue;
        }

        const update = buildActiveTerminalUpdate({ now, row });
        const { data: updated, error: updateError } = await supabase
          .from('conversations')
          .update(update)
          .eq('tenant_id', args.tenantId)
          .eq('id', row.id)
          .eq('source', browserConversationSource)
          .eq('status', row.status)
          .select('id')
          .maybeSingle();

        if (!updateError && updated) {
          finalizedCount += 1;
        }
      }

      return finalizedCount;
    } catch {
      // Best-effort cleanup; listing conversations should still succeed.
      return 0;
    }
  };
}

export const reconcileStaleConversations =
  createReconcileStaleConversationsService({
    createServerSupabaseAdminClient,
    getSupabaseAdminEnv,
    now: () => new Date(),
  });
