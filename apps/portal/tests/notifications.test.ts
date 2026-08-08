import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCloseOffNotificationBody,
  deliverCloseOffNotification,
} from '../lib/notifications/deliver-close-off';
import {
  normalizeWhatsAppChatId,
  sendGreenApiWhatsAppMessage,
} from '../lib/notifications/green-api';
import {
  buildNotificationFiltersHref,
  formatNotificationKindLabel,
  hasActiveNotificationFilters,
  normalizeNotificationFilters,
  truncateNotificationBody,
} from '../lib/notifications/helpers';

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

test('deliverCloseOffNotification logs an inbox entry without destinations', async () => {
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

      throw new Error(`Unexpected table ${table}`);
    },
  };

  const result = await deliverCloseOffNotification({
    agentId: 'agent-1',
    conversationId: 'conv-1',
    outcome: 'Completed',
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
