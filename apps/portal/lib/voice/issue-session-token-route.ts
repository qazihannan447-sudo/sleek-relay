import type { IssueVoiceSessionTokenResult } from './issue-session-token';

type SessionTokenRouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export function createIssueVoiceSessionTokenRouteHandler(
  handler: (_conversationId: string) => Promise<IssueVoiceSessionTokenResult>,
) {
  return async function POST(request: Request, context: SessionTokenRouteContext) {
    void request;

    const { conversationId } = await context.params;
    const result = await handler(conversationId);

    return Response.json(result.body, {
      headers: result.headers,
      status: result.status,
    });
  };
}
