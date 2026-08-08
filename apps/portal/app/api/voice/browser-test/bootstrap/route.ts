import { bootstrapBrowserVoiceSession } from '../../../../../lib/voice/bootstrap-browser-session';
import { parseStartConversationJsonRequest } from '../../../../../lib/voice/start-conversation';

export async function POST(request: Request) {
  const parsed = await parseStartConversationJsonRequest(request);

  if (!parsed.ok) {
    return Response.json(parsed.body, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
      status: parsed.status,
    });
  }

  const result = await bootstrapBrowserVoiceSession(parsed.data);

  return Response.json(result.body, {
    headers: result.headers,
    status: result.status,
  });
}
