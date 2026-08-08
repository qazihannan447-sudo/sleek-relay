import { loadVoicePreviewForRequest } from '../../../../../lib/voices/load-voice-preview';

type RouteContext = {
  params: Promise<{ voiceId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { voiceId } = await context.params;
  const result = await loadVoicePreviewForRequest(voiceId);

  if (result.kind === 'error') {
    return Response.json({ error: result.message }, { status: result.status });
  }

  return new Response(result.body, {
    headers: {
      'Cache-Control': 'private, max-age=3600',
      'Content-Type': result.contentType,
    },
  });
}
