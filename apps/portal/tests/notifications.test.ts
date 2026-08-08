import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCloseOffNotificationBody,
  buildCloseOffNotificationHtml,
  deliverCloseOffNotification,
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

test('buildCloseOffNotificationBody includes outcome summary and review link', () => {
  const body = buildCloseOffNotificationBody({
    conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    outcome: 'Completed',
    portalBaseUrl: 'https://sleek-relay.vercel.app',
    summary: 'Caller asked about hours.',
  });

  assert.match(body, /Outcome: Completed/);
  assert.match(body, /Caller asked about hours/);
  assert.match(
    body,
    /https:\/\/sleek-relay\.vercel\.app\/dashboard\/conversations\?conversationId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/,
  );
  assert.match(buildCloseOffNotificationHtml(body), /<br \/>/);
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
  inserts: unknown[];
  notificationEmail?: string | null;
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

test('deliverCloseOffNotification logs an inbox entry without destinations', async () => {
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
    channel: 'inbox',
    created: true,
    destination: 'Business inbox',
    id: 'notification-1',
    status: 'logged',
  });
  assert.equal(inserts.length, 1);
  assert.equal((inserts[0] as { channel: string }).channel, 'inbox');
  assert.equal((inserts[0] as { status: string }).status, 'logged');
  assert.equal((inserts[0] as { provider: string }).provider, 'demo_log');
});

test('deliverCloseOffNotification sends Resend email when configured', async () => {
  const inserts: unknown[] = [];
  const supabase = createDeliverSupabaseMock({
    inserts,
    notificationEmail: 'alerts@greenleaf.example.com',
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

  assert.equal(result.created, true);
  if (result.created) {
    assert.deepEqual(result.email, {
      channel: 'email',
      destination: 'alerts@greenleaf.example.com',
      id: 'notification-2',
      status: 'sent',
    });
  }
  assert.equal(inserts.length, 2);
  assert.equal((inserts[1] as { channel: string }).channel, 'email');
  assert.equal((inserts[1] as { status: string }).status, 'sent');
  assert.equal((inserts[1] as { provider: string }).provider, 'resend');
  assert.equal(
    (inserts[1] as { provider_message_id: string }).provider_message_id,
    'email-123',
  );
  assert.equal(sendCalls.length, 1);
});

test('deliverCloseOffNotification logs failed email without throwing', async () => {
  const inserts: unknown[] = [];
  const supabase = createDeliverSupabaseMock({
    inserts,
    notificationEmail: 'alerts@greenleaf.example.com',
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

  assert.equal(result.created, true);
  if (result.created) {
    assert.equal(result.email?.status, 'failed');
  }
  assert.equal((inserts[1] as { status: string }).status, 'failed');
  assert.equal(
    (inserts[1] as { error_message: string }).error_message,
    'Resend unavailable',
  );
});

test('deliverCloseOffNotification skips email when Resend is not configured', async () => {
  const inserts: unknown[] = [];
  const supabase = createDeliverSupabaseMock({
    inserts,
    notificationEmail: 'alerts@greenleaf.example.com',
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

  assert.equal(result.created, true);
  if (result.created) {
    assert.equal(result.email, undefined);
  }
  assert.equal(inserts.length, 1);
});
