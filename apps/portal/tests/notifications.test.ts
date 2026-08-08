import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseCloseOffDestination,
  buildCloseOffNotificationBody,
  deliverCloseOffNotification,
} from '../lib/notifications/deliver-close-off';
import {
  normalizeWhatsAppChatId,
  sendGreenApiWhatsAppMessage,
} from '../lib/notifications/green-api';
import {
  buildNotificationFiltersHref,
  formatNotificationChannelLabel,
  formatNotificationStatusLabel,
  hasActiveNotificationFilters,
  normalizeNotificationFilters,
  truncateNotificationBody,
} from '../lib/notifications/helpers';

const agents = [
  { id: 'agent-1', name: 'Front desk' },
  { id: 'agent-2', name: 'Sales' },
];

test('normalizeNotificationFilters keeps valid channel status and agent filters', () => {
  const filters = normalizeNotificationFilters(
    {
      agent: 'agent-2',
      channel: 'whatsapp',
      from: '2026-08-01',
      page: '2',
      status: 'sent',
      to: '2026-08-08',
    },
    agents,
  );

  assert.equal(filters.channel, 'whatsapp');
  assert.equal(filters.status, 'sent');
  assert.equal(filters.agentId, 'agent-2');
  assert.equal(filters.page, 2);
  assert.equal(hasActiveNotificationFilters(filters), true);
});

test('normalizeNotificationFilters drops unknown values', () => {
  const filters = normalizeNotificationFilters(
    {
      agent: 'missing',
      channel: 'sms',
      status: 'queued',
    },
    agents,
  );

  assert.equal(filters.channel, null);
  assert.equal(filters.status, null);
  assert.equal(filters.agentId, null);
  assert.equal(hasActiveNotificationFilters(filters), false);
});

test('buildNotificationFiltersHref encodes filters and omits page 1', () => {
  const filters = normalizeNotificationFilters(
    {
      channel: 'email',
      page: '1',
      status: 'logged',
    },
    agents,
  );

  assert.equal(
    buildNotificationFiltersHref('/dashboard/notifications', filters),
    '/dashboard/notifications?channel=email&status=logged',
  );
});

test('notification label helpers stay readable', () => {
  assert.equal(formatNotificationChannelLabel('whatsapp'), 'WhatsApp');
  assert.equal(formatNotificationStatusLabel('logged'), 'Logged (demo)');
  assert.equal(
    truncateNotificationBody('one two three four five', 12),
    'one two thr…',
  );
});

test('chooseCloseOffDestination prefers WhatsApp over email', () => {
  assert.deepEqual(
    chooseCloseOffDestination({
      notificationEmail: 'alerts@example.com',
      notificationWhatsapp: '+15551234567',
    }),
    {
      channel: 'whatsapp',
      destination: '+15551234567',
    },
  );

  assert.deepEqual(
    chooseCloseOffDestination({
      notificationEmail: 'alerts@example.com',
      notificationWhatsapp: null,
    }),
    {
      channel: 'email',
      destination: 'alerts@example.com',
    },
  );

  assert.equal(
    chooseCloseOffDestination({
      notificationEmail: null,
      notificationWhatsapp: null,
    }),
    null,
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

test('deliverCloseOffNotification logs WhatsApp when Green API is unset', async () => {
  const inserts: unknown[] = [];
  const supabase = {
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
            inserts.push(row);
            return {
              select() {
                return {
                  maybeSingle: async () => ({
                    data: { id: 'notification-1' },
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
                  notification_email: 'alerts@example.com',
                  notification_whatsapp: '+15551234567',
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

  const result = await deliverCloseOffNotification({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    greenApiConfig: null,
    outcome: 'Completed',
    summary: 'Caller left a message.',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    tenantId: 'tenant-1',
  });

  assert.deepEqual(result, {
    channel: 'whatsapp',
    created: true,
    destination: '+15551234567',
    id: 'notification-1',
    status: 'logged',
  });
  assert.equal(inserts.length, 1);
});
