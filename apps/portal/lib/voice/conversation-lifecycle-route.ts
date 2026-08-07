import type { BrowserConversationLifecycleResult } from './conversation-lifecycle';

type ConversationLifecycleRouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export function createBrowserConversationLifecycleRouteHandler(
  handler: (_args: {
    conversationId: string;
    request: Request;
  }) => Promise<BrowserConversationLifecycleResult>,
) {
  return async function PATCH(
    request: Request,
    context: ConversationLifecycleRouteContext,
  ) {
    const { conversationId } = await context.params;
    const result = await handler({
      conversationId,
      request,
    });

    return Response.json(result.body, {
      headers: result.headers,
      status: result.status,
    });
  };
}
