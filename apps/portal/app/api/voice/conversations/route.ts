import {
  parseStartConversationJsonRequest,
  startConversation,
} from '../../../../lib/voice/start-conversation';

export async function POST(request: Request) {
  const parsed = await parseStartConversationJsonRequest(request);

  if (!parsed.ok) {
    return Response.json(parsed.body, { status: parsed.status });
  }

  const result = await startConversation(parsed.data);

  return Response.json(result.body, { status: result.status });
}
