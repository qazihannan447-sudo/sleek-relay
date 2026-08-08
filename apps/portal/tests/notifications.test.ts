import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCloseOffNotificationBody,
  buildCloseOffNotificationHtml,
  deliverCloseOffNotification,
  formatCloseOffCapturesSection,
  resolveCloseOffNotificationDestination,
} from '../lib/notifications/deliver-close-off';
import {
  normalizeWhatsAppChatId,
  sendGreenApiWhatsAppMessage,
} from '../lib/notifications/green-api';
import {
  buildNotificationFiltersHref,
  formatNotificationChannelLabel,
  formatNotificationKindLabel,
  formatNotificationStatusLabel,
  hasActiveNotificationFilters,
  normalizeNotificationFilters,
  truncateNotificationBody,
} from '../lib/notifications/helpers';
import {
  loadResendConfigFromEnv,
  sendResendEmail,
} from '../lib/notifications/resend';

const agents = [
  { id: 'agent-1', name: 'Front desk' },
  { id: 'agent-2', name: 'Sales' },
];

test('normalizeNotificationFilters keeps valid agent and date filters', () => {
  const filters = normalizeNotificationFilters(
    {
      agent: 'agent-2',
      from: '2026-08-01',
      page: '2',
      to: '2026-08-08',
    },
    agents,
  );

  assert.equal(filters.agentId, 'agent-2');
  assert.equal(filters.from, '2026-08-01');
  assert.equal(filters.to, '2026-08-08');
  assert.equal(filters.page, 2);
  assert.equal(hasActiveNotificationFilters(filters), true);
});

test('normalizeNotificationFilters drops unknown values', () => {
  const filters = normalizeNotificationFilters(
    {
      agent: 'missing',
      from: 'not-a-date',
      to: 'also-bad',
    },
    agents,
  );

  assert.equal(filters.agentId, null);
  assert.equal(filters.from, null);
  assert.equal(filters.to, null);
  assert.equal(hasActiveNotificationFilters(filters), false);
});

test('buildNotificationFiltersHref encodes filters and omits page 1', () => {
  const filters = normalizeNotificationFilters(
    {
      agent: 'agent-1',
      from: '2026-08-01',
      page: '1',
    },
    agents,
  );

  assert.equal(
    buildNotificationFiltersHref('/dashboard/notifications', filters),
    '/dashboard/notifications?agent=agent-1&from=2026-08-01',
  );
});

test('notification label helpers stay readable', () => {
  assert.equal(formatNotificationKindLabel('close_off'), 'Post-call close-off');
  assert.equal(formatNotificationChannelLabel('email'), 'Email');
  assert.equal(formatNotificationStatusLabel('sent'), 'Sent');
  assert.equal(
    truncateNotificationBody('one two three four five', 12),
    'one two thr…',
  );
});

test('normalizeWhatsAppChatId strips formatting', () => {
  assert.equal(normalizeWhatsAppChatId('+1 (555) 123-4567'), '15551234567@c.us');
  assert.equal(normalizeWhatsAppChatId('123'), null);
});

test('buildCloseOffNotificationBody includes captures digest', () => {
  const body = buildCloseOffNotificationBody({
    captures: [
      {
        capture_type: 'lead',
        payload: {
          email: 'alex@example.com',
          name: 'Alex',
          phone: '+15551234567',
        },
        status: 'captured',
      },
      {
        capture_type: 'appointment_request',
        payload: {
          name: 'Alex',
          preferredTime: 'Friday 2pm',
        },
        status: 'requested',
      },
    ],
    outcome: 'appointment_requested',
    summary: 'Caller asked to book a visit.',
  });

  assert.match(body, /Outcome: appointment_requested/);
  assert.match(body, /Caller asked to book a visit/);
  assert.match(body, /1\. Lead \(Captured\)/);
  assert.match(body, /Name: Alex/);
  assert.match(body, /2\. Appointment request \(Requested\)/);
  assert.match(body, /Preferred time: Friday 2pm/);
  assert.doesNotMatch(body, /Review:/);
  assert.doesNotMatch(body, /https:\/\//);
  assert.match(buildCloseOffNotificationHtml(body), /<br \/>/);
});

test('formatCloseOffCapturesSection handles empty captures', () => {
  assert.match(
    formatCloseOffCapturesSection([]),
    /None recorded for this conversation/,
  );
});

test('sendGreenApiWhatsAppMessage returns message id on success', async () => {
  const result = await sendGreenApiWhatsAppMessage({
    chatId: '15551234567@c.us',
    config: {
      apiTokenInstance: 'token',
      apiUrl: 'https://api.green-api.com',
      idInstance: '123',
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ idMessage: 'msg-1' }), { status: 200 }),
    message: 'hello',
  });

  assert.deepEqual(result, { messageId: 'msg-1', ok: true });
});

test('loadResendConfigFromEnv requires API key and defaults from address', () => {
  assert.equal(
    loadResendConfigFromEnv({} as unknown as NodeJS.ProcessEnv),
    null,
  );
  assert.deepEqual(
    loadResendConfigFromEnv({
      RESEND_API_KEY: 're_test',
    } as unknown as NodeJS.ProcessEnv),
    {
      apiKey: 're_test',
      fromEmail: 'Sleek Relay <notifications@admin.awaazlabs.io>',
    },
  );
});

test('sendResendEmail returns message id on success', async () => {
  const result = await sendResendEmail({
    config: {
      apiKey: 're_test',
      fromEmail: 'Sleek Relay <notifications@admin.awaazlabs.io>',
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }),
    subject: 'Hello',
    text: 'Body',
    to: 'owner@example.com',
  });

  assert.deepEqual(result, { messageId: 'email-1', ok: true });
});

function createDeliverSupabaseMock(args: {
  captures?: Array<{
    capture_type: string;
    payload: unknown;
    status: string;
  }>;
  contactEmail?: string | null;
  inserts: unknown[];
  notificationEmail?: string | null;
  updates?: unknown[];
}) {
  let notificationId = 0;

  return {
    from(table: string) {
      if (table === 'conversation_notifications') {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              maybeSingle: async () => ({ data: null, error: null }),
            };
          },
          delete() {
            return {
              eq() {
                return this;
              },
              then: async (resolve: (value: { error: null }) => unknown) =>
                resolve({ error: null }),
            };
          },
          insert(row: unknown) {
            args.inserts.push(row);
            notificationId += 1;
            return {
              select() {
                return {
                  maybeSingle: async () => ({
                    data: { id: `notification-${notificationId}` },
                    error: null,
                  }),
                };
              },
            };
          },
          update(row: unknown) {
            args.updates?.push(row);
            return {
              eq() {
                return this;
              },
              then: async (resolve: (value: { error: null }) => unknown) =>
                resolve({ error: null }),
            };
          },
        };
      }

      if (table === 'conversation_captures') {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              order: async () => ({
                data: args.captures ?? [],
                error: null,
              }),
            };
          },
        };
      }

      if (table === 'business_configurations') {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              maybeSingle: async () => ({
                data: {
                  contact_email: args.contactEmail ?? null,
                  notification_email: args.notificationEmail ?? null,
                },
                error: null,
              }),
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

test('resolveCloseOffNotificationDestination prefers notification email', () => {
  assert.equal(
    resolveCloseOffNotificationDestination({
      contactEmail: 'contact@example.com',
      notificationEmail: 'alerts@example.com',
    }),
    'alerts@example.com',
  );
  assert.equal(
    resolveCloseOffNotificationDestination({
      contactEmail: 'contact@example.com',
      notificationEmail: null,
    }),
    'contact@example.com',
  );
});

test('deliverCloseOffNotification records failed when no destination is configured', async () => {
  const inserts: unknown[] = [];
  const supabase = createDeliverSupabaseMock({ inserts });

  const result = await deliverCloseOffNotification({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    outcome: 'Completed',
    resendConfig: {
      apiKey: 're_test',
      fromEmail: 'Sleek Relay <notifications@admin.awaazlabs.io>',
    },
    summary: 'Caller left a message.',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    tenantId: 'tenant-1',
  });

  assert.deepEqual(result, {
    channel: 'email',
    created: true,
    destination: 'Not configured',
    id: 'notification-1',
    status: 'failed',
  });
  assert.equal(inserts.length, 1);
  assert.equal((inserts[0] as { status: string }).status, 'failed');
});

test('deliverCloseOffNotification falls back to contact email', async () => {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const supabase = createDeliverSupabaseMock({
    contactEmail: 'info@finovasolutions.tech',
    inserts,
    updates,
  });

  const result = await deliverCloseOffNotification({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    outcome: 'Completed',
    resendConfig: {
      apiKey: 're_test',
      fromEmail: 'Sleek Relay <notifications@admin.awaazlabs.io>',
    },
    sendEmail: async () => ({ messageId: 'email-123', ok: true }),
    summary: 'Caller left a message.',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    tenantId: 'tenant-1',
  });

  assert.deepEqual(result, {
    channel: 'email',
    created: true,
    destination: 'info@finovasolutions.tech',
    id: 'notification-1',
    status: 'sent',
  });
  assert.equal((inserts[0] as { destination: string }).destination, 'info@finovasolutions.tech');
  assert.equal((inserts[0] as { status: string }).status, 'logged');
  assert.equal((updates[0] as { status: string }).status, 'sent');
});

test('deliverCloseOffNotification sends Resend email when configured', async () => {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const supabase = createDeliverSupabaseMock({
    inserts,
    notificationEmail: 'alerts@greenleaf.example.com',
    updates,
  });
  const sendCalls: unknown[] = [];

  const result = await deliverCloseOffNotification({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    outcome: 'Completed',
    resendConfig: {
      apiKey: 're_test',
      fromEmail: 'Sleek Relay <notifications@admin.awaazlabs.io>',
    },
    sendEmail: async (args) => {
      sendCalls.push(args);
      return { messageId: 'email-123', ok: true };
    },
    summary: 'Caller left a message.',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    tenantId: 'tenant-1',
  });

  assert.deepEqual(result, {
    channel: 'email',
    created: true,
    destination: 'alerts@greenleaf.example.com',
    id: 'notification-1',
    status: 'sent',
  });
  assert.equal(inserts.length, 1);
  assert.equal((inserts[0] as { channel: string }).channel, 'email');
  assert.equal((inserts[0] as { status: string }).status, 'logged');
  assert.equal((inserts[0] as { destination: string }).destination, 'alerts@greenleaf.example.com');
  assert.equal((updates[0] as { status: string }).status, 'sent');
  assert.equal(
    (updates[0] as { provider_message_id: string }).provider_message_id,
    'email-123',
  );
  assert.equal(sendCalls.length, 1);
});

test('deliverCloseOffNotification includes capture details in the body', async () => {
  const inserts: unknown[] = [];
  const supabase = createDeliverSupabaseMock({
    captures: [
      {
        capture_type: 'lead',
        payload: { name: 'Sam', phone: '+15550001111' },
        status: 'captured',
      },
    ],
    inserts,
    notificationEmail: 'alerts@greenleaf.example.com',
    updates: [],
  });

  await deliverCloseOffNotification({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    outcome: 'lead_captured',
    resendConfig: {
      apiKey: 're_test',
      fromEmail: 'Sleek Relay <notifications@admin.awaazlabs.io>',
    },
    sendEmail: async () => ({ messageId: 'email-123', ok: true }),
    summary: 'Caller left contact details.',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    tenantId: 'tenant-1',
  });

  const body = (inserts[0] as { body: string }).body;
  assert.match(body, /1\. Lead \(Captured\)/);
  assert.match(body, /Name: Sam/);
  assert.match(body, /Phone: \+15550001111/);
});

test('deliverCloseOffNotification logs failed email without throwing', async () => {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const supabase = createDeliverSupabaseMock({
    inserts,
    notificationEmail: 'alerts@greenleaf.example.com',
    updates,
  });

  const result = await deliverCloseOffNotification({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    outcome: 'Completed',
    resendConfig: {
      apiKey: 're_test',
      fromEmail: 'Sleek Relay <notifications@admin.awaazlabs.io>',
    },
    sendEmail: async () => ({
      errorMessage: 'Resend unavailable',
      ok: false,
    }),
    summary: 'Caller left a message.',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    tenantId: 'tenant-1',
  });

  assert.deepEqual(result, {
    channel: 'email',
    created: true,
    destination: 'alerts@greenleaf.example.com',
    id: 'notification-1',
    status: 'failed',
  });
  assert.equal((updates[0] as { status: string }).status, 'failed');
  assert.equal(
    (updates[0] as { error_message: string }).error_message,
    'Resend unavailable',
  );
});

test('deliverCloseOffNotification records failed when Resend is not configured', async () => {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const supabase = createDeliverSupabaseMock({
    inserts,
    notificationEmail: 'alerts@greenleaf.example.com',
    updates,
  });

  const result = await deliverCloseOffNotification({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    outcome: 'Completed',
    resendConfig: null,
    summary: 'Caller left a message.',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    tenantId: 'tenant-1',
  });

  assert.deepEqual(result, {
    channel: 'email',
    created: true,
    destination: 'alerts@greenleaf.example.com',
    id: 'notification-1',
    status: 'failed',
  });
  assert.equal(inserts.length, 1);
  assert.equal((updates[0] as { status: string }).status, 'failed');
  assert.match(
    (updates[0] as { error_message: string }).error_message,
    /Resend is not configured/,
  );
});
