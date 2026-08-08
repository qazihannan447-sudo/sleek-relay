import { createConversationSummaryStatusService } from '../../../../../../lib/conversations/conversation-summary-status';
import { generateConversationSummaryFromTranscript } from '../../../../../../lib/conversations/generate-conversation-summary';
import { loadWorkspaceContext } from '../../../../../../lib/dashboard/load-workspace-context';
import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../../../../../../lib/supabase/admin';

const getConversationSummaryStatus = createConversationSummaryStatusService({
  createServerSupabaseAdminClient,
  generateConversationSummary: generateConversationSummaryFromTranscript,
  getSupabaseAdminEnv,
  loadWorkspaceContext,
});

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const result = await getConversationSummaryStatus({ conversationId });

  return Response.json(result.body, {
    headers: result.headers,
    status: result.status,
  });
}
