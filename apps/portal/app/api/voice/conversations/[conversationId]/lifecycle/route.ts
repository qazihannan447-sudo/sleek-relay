import { after } from 'next/server';

import {
  createBrowserConversationLifecycleRouteHandler,
} from '../../../../../../lib/voice/conversation-lifecycle-route';
import {
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
