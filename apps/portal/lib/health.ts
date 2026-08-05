export type HealthPayload = {
  ok: true;
  service: 'portal';
  timestamp: string;
};

export function getHealthPayload(): HealthPayload {
  return {
    ok: true,
    service: 'portal',
    timestamp: new Date().toISOString(),
  };
}
