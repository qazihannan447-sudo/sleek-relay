import { getHealthPayload } from '../../../lib/health';

export async function GET() {
  return Response.json(getHealthPayload());
}
