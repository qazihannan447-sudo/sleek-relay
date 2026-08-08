import { after } from 'next/server';
import { revalidatePath } from 'next/cache';

import {
  createBrowserConversationLifecycleRouteHandler,
} from '../../../../../../lib/voice/conversation-lifecycle-route';
import {
  CONVERSATIONS_DASHBOARD_PATH,
  createBrowserConversationLifecycleService,
  parseBrowserConversationLifecycleJsonRequest,
} from '../../../../../../lib/voice/conversation-lifecycle';
import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../../../../../../lib/supabase/admin';
import { loadWorkspaceContext } from '../../../../../../lib/dashboard/load-workspace-context';
import { generateConversationSummaryFromTranscript } from '../../../../../../lib/conversations/generate-conversation-summary';

const updateBrowserConversationLifecycle =
  createBrowserConversationLifecycleService({
    createServerSupabaseAdminClient,
    generateConversationSummary: generateConversationSummaryFromTranscript,
    getSupabaseAdminEnv,
    loadWorkspaceContext,
    now: () => new Date(),
    revalidateConversationsPath: () => {
      revalidatePath(CONVERSATIONS_DASHBOARD_PATH);
    },
    scheduleBackgroundWork: after,
  });

export const PATCH = createBrowserConversationLifecycleRouteHandler(
  async ({ conversationId, request }) => {
    const parsed = await parseBrowserConversationLifecycleJsonRequest(request);

    if (!parsed.ok) {
      return {
        body: parsed.body,
        headers: {
          'Cache-Control': 'no-store',
        },
        status: parsed.status,
      };
    }

    return updateBrowserConversationLifecycle({
      conversationId,
      request: parsed.data,
    });
  },
);
