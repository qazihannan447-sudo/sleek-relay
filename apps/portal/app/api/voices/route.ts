import { loadVoiceCatalogForRequest } from '../../../lib/voices/load-voice-catalog';

export async function GET() {
  const result = await loadVoiceCatalogForRequest();

  if (result.kind === 'error') {
    return Response.json({ error: result.message }, { status: result.status });
  }

  return Response.json(
    { voices: result.voices },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
