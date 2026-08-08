import { discardUnusedConversation } from '../../../../../lib/voice/discard-unused-conversation';

type DiscardUnusedConversationRouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function DELETE(
  _request: Request,
  context: DiscardUnusedConversationRouteContext,
) {
  const { conversationId } = await context.params;
  const result = await discardUnusedConversation({ conversationId });

  return Response.json(result.body, {
    headers: result.headers,
    status: result.status,
  });
}
