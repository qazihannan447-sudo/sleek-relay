export const VOICE_PREVIEW_BUCKET = 'voice-previews';

export function buildVoicePreviewPublicUrl(
  supabaseUrl: string,
  storagePath: string,
): string {
  const base = supabaseUrl.replace(/\/$/, '');
  const path = storagePath.replace(/^\/+/, '');
  return `${base}/storage/v1/object/public/${VOICE_PREVIEW_BUCKET}/${path}`;
}
