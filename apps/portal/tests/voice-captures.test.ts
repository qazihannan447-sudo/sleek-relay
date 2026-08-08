import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCapabilityFieldPolicy,
  buildHandoffSpeakAs,
  captureLeadArgsSchema,
  isCaptureToolAllowed,
  isHandoffDestinationConfigured,
  outcomeForCaptureType,
  parseCaptureToolArgs,
  parseCreateCaptureRequest,
  speakAsForCaptureType,
  statusForCaptureType,
} from '../lib/voice/capture-schema';
import { createConversationCaptureService } from '../lib/voice/captures';
import { emptyAgentCapabilities } from '../lib/agents/capabilities';

function voiceClaims(conversationId: string) {
  return {
    agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
    audience: 'sleek-relay-voice-worker' as const,
    conversationId,
    expiresAt: '2099-01-01T00:00:00.000Z',
    issuedAt: '2026-08-08T00:00:00.000Z',
    issuer: 'sleek-relay-portal' as const,
    purpose: 'voice-session' as const,
    source: 'browser_test' as const,
    subject: conversationId,
    tokenId: 'token-1',
    version: 1 as const,
  };
}

test('parseCreateCaptureRequest accepts lead, message, appointment, and handoff tools', () => {
  const lead = parseCreateCaptureRequest({
    args: { name: 'Habiba' },
    tool: 'capture_lead',
  });
  const message = parseCreateCaptureRequest({
    args: { message: 'Please call me back.' },
    tool: 'capture_message',
  });
  const appointment = parseCreateCaptureRequest({
    args: { name: 'Habiba', preferredTime: 'Tuesday at 3pm' },
    tool: 'create_appointment_request',
  });
  const handoff = parseCreateCaptureRequest({
    args: { reason: 'Wants to speak with a person' },
    tool: 'offer_human_handoff',
  });

  assert.equal(lead.ok, true);
  assert.equal(message.ok, true);
  assert.equal(appointment.ok, true);
  assert.equal(handoff.ok, true);
});

test('parseCaptureToolArgs requires name for leads and message for messages', () => {
  const missingName = parseCaptureToolArgs('capture_lead', {});
  const validLead = parseCaptureToolArgs('capture_lead', {
    name: 'Habiba',
    phone: '03055780214',
  });
  const missingMessage = parseCaptureToolArgs('capture_message', {
    name: 'Habiba',
  });

  assert.equal(missingName.ok, false);
  assert.equal(validLead.ok, true);
  assert.equal(missingMessage.ok, false);
});

test('parseCaptureToolArgs requires name and preferred time for appointments', () => {
  const missingPreferred = parseCaptureToolArgs('create_appointment_request', {
    name: 'Habiba',
  });
  const snakeCase = parseCaptureToolArgs('create_appointment_request', {
    name: 'Habiba',
    preferred_time: 'Tuesday at 3pm',
    phone: '03055780214',
  });
  const camelCase = parseCaptureToolArgs('create_appointment_request', {
    name: 'Habiba',
    preferredTime: 'Wednesday morning',
  });

  assert.equal(missingPreferred.ok, false);
  assert.equal(snakeCase.ok, true);
  assert.equal(camelCase.ok, true);
  if (snakeCase.ok) {
    assert.equal(
      (snakeCase.payload as { preferredTime: string }).preferredTime,
      'Tuesday at 3pm',
    );
  }
});

test('parseCaptureToolArgs requires reason for handoff requests', () => {
  const missingReason = parseCaptureToolArgs('offer_human_handoff', {});
  const snakeCase = parseCaptureToolArgs('offer_human_handoff', {
    reason: 'Needs a human',
    caller_name: 'Habiba',
    callback_phone: '03055780214',
  });

  assert.equal(missingReason.ok, false);
  assert.equal(snakeCase.ok, true);
  if (snakeCase.ok) {
    assert.equal(
      (snakeCase.payload as { callerName?: string }).callerName,
      'Habiba',
    );
  }
});

test('isCaptureToolAllowed respects agent capability flags', () => {
  const capabilities = emptyAgentCapabilities();
  assert.equal(isCaptureToolAllowed('capture_lead', capabilities), false);
  assert.equal(
    isCaptureToolAllowed('create_appointment_request', capabilities),
    false,
  );
  assert.equal(isCaptureToolAllowed('offer_human_handoff', capabilities), false);

  capabilities.captureLeads = true;
  assert.equal(isCaptureToolAllowed('capture_lead', capabilities), true);
  assert.equal(isCaptureToolAllowed('capture_message', capabilities), false);

  capabilities.captureAppointments = true;
  assert.equal(
    isCaptureToolAllowed('create_appointment_request', capabilities),
    true,
  );

  capabilities.offerHandoff = true;
  assert.equal(isCaptureToolAllowed('offer_human_handoff', capabilities), true);
});

test('outcome and status map appointment and handoff requests as requested only', () => {
  assert.equal(outcomeForCaptureType('lead'), 'lead_captured');
  assert.equal(outcomeForCaptureType('message'), 'message_captured');
  assert.equal(outcomeForCaptureType('appointment_request'), 'appointment_requested');
  assert.equal(outcomeForCaptureType('handoff_request'), 'handoff_requested');
  assert.equal(statusForCaptureType('lead'), 'captured');
  assert.equal(statusForCaptureType('appointment_request'), 'requested');
  assert.equal(statusForCaptureType('handoff_request'), 'requested');
  assert.notEqual(statusForCaptureType('appointment_request'), 'confirmed');
  assert.match(
    speakAsForCaptureType('appointment_request') ?? '',
    /team will confirm/i,
  );
  assert.match(
    speakAsForCaptureType('appointment_request') ?? '',
    /anything else I can help with/i,
  );
  assert.match(
    speakAsForCaptureType('lead') ?? '',
    /saved your details/i,
  );
  assert.match(
    speakAsForCaptureType('lead') ?? '',
    /end_session/i,
  );
  assert.match(
    speakAsForCaptureType('message') ?? '',
    /taken that message/i,
  );
  assert.equal(isHandoffDestinationConfigured('none'), false);
  assert.equal(isHandoffDestinationConfigured('callback'), true);
  assert.match(
    buildHandoffSpeakAs({
      destinationType: 'phone_info',
      destinationValue: '555-0100',
      script: 'Please call us at {destination}.',
    }),
    /555-0100/,
  );
  assert.match(
    buildHandoffSpeakAs({
      destinationType: 'callback',
      destinationValue: null,
      script: 'Someone will call you back.',
    }),
    /Someone will call you back/,
  );
  assert.match(
    buildHandoffSpeakAs({
      destinationType: 'callback',
      destinationValue: null,
      script: 'Someone will call you back.',
    }),
    /anything else I can help with/i,
  );
});

test('applyCapabilityFieldPolicy requires configured fields and strips others', () => {
  const capabilities = emptyAgentCapabilities();
  capabilities.captureLeads = true;
  capabilities.leadFields = ['name', 'phone'];

  const missingPhone = applyCapabilityFieldPolicy(
    'capture_lead',
    { name: 'Habiba' },
    capabilities,
  );
  const valid = applyCapabilityFieldPolicy(
    'capture_lead',
    { email: 'h@example.com', name: 'Habiba', phone: '03055780214' },
    capabilities,
  );

  assert.equal(missingPhone.ok, false);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.payload.email, undefined);
    assert.equal(valid.payload.phone, '03055780214');
  }
});

test('captureLeadArgsSchema trims blank optional contact fields', () => {
  const parsed = captureLeadArgsSchema.parse({
    email: '',
    name: ' Habiba ',
    notes: '',
    phone: '03055780214',
  });

  assert.equal(parsed.name, 'Habiba');
  assert.equal(parsed.phone, '03055780214');
  assert.equal(parsed.email, undefined);
  assert.equal(parsed.notes, undefined);
});

test('createConversationCaptureService returns 401 for missing bearer tokens', async () => {
  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () => {
      throw new Error('should not create admin client');
    },
    getSupabaseAdminEnv: () => {
      throw new Error('should not read admin env');
    },
    verifyVoiceSessionToken: async () => {
      throw new Error('should not verify');
    },
  });

  const result = await createCapture({
    authorizationHeader: null,
    body: { args: { name: 'Habiba' }, tool: 'capture_lead' },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 401);
});

test('createConversationCaptureService rejects cross-conversation tokens', async () => {
  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () => {
      throw new Error('should not create admin client');
    },
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('bbbbbbbb-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: { args: { name: 'Habiba' }, tool: 'capture_lead' },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 404);
});

test('createConversationCaptureService denies disabled capture tools', async () => {
  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: {
                                  capture_appointments: false,
                                  capture_leads: false,
                                  capture_messages: false,
                                  offer_handoff: false,
                                },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: { args: { name: 'Habiba' }, tool: 'capture_lead' },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 403);
  assert.equal(
    'result' in result.body && result.body.result && result.body.result.ok === false,
    true,
  );
});

test('createConversationCaptureService persists a lead and updates outcome', async () => {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];

  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
              update(payload: unknown) {
                updates.push(payload);
                return {
                  eq() {
                    return {
                      eq() {
                        return Promise.resolve({ error: null });
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: {
                                  capture_appointments: true,
                                  capture_leads: true,
                                  capture_messages: true,
                                  lead_fields: ['name'],
                                  offer_handoff: true,
                                },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'conversation_captures') {
            return {
              insert(payload: unknown) {
                inserts.push(payload);
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: {
                            capture_type: 'lead',
                            id: 'cccccccc-1000-4000-8000-000000000001',
                            status: 'captured',
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: { name: 'Habiba', phone: '03055780214' },
      idempotencyKey: 'lead-1',
      tool: 'capture_lead',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 200);
  if (!('result' in result.body) || !result.body.result || !result.body.result.ok) {
    assert.fail('expected successful capture result');
  }
  assert.equal(inserts.length, 1);
  assert.deepEqual(updates[0], { outcome: 'lead_captured' });
});

test('createConversationCaptureService persists appointment requests as requested', async () => {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: unknown[] = [];

  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
              update(payload: unknown) {
                updates.push(payload);
                return {
                  eq() {
                    return {
                      eq() {
                        return Promise.resolve({ error: null });
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: {
                                  capture_appointments: true,
                                  capture_leads: false,
                                  capture_messages: false,
                                  appointment_fields: ['name', 'preferred_time'],
                                  offer_handoff: false,
                                },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'conversation_captures') {
            return {
              insert(payload: Record<string, unknown>) {
                inserts.push(payload);
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: {
                            capture_type: 'appointment_request',
                            id: 'cccccccc-1000-4000-8000-000000000002',
                            status: 'requested',
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: {
        name: 'Habiba',
        preferredTime: 'Tuesday at 3pm',
        phone: '03055780214',
      },
      idempotencyKey: 'appt-1',
      tool: 'create_appointment_request',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 200);
  if (!('result' in result.body) || !result.body.result || !result.body.result.ok) {
    assert.fail('expected successful appointment capture result');
  }
  assert.equal(result.body.result.captureType, 'appointment_request');
  assert.equal(result.body.result.status, 'requested');
  assert.notEqual(result.body.result.status, 'confirmed');
  assert.match(result.body.result.speakAs ?? '', /team will confirm/i);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.capture_type, 'appointment_request');
  assert.equal(inserts[0]?.status, 'requested');
  assert.deepEqual(updates[0], { outcome: 'appointment_requested' });
});

test('createConversationCaptureService denies appointment tool when capability off', async () => {
  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: {
                                  capture_appointments: false,
                                  capture_leads: true,
                                  capture_messages: true,
                                  offer_handoff: false,
                                },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: { name: 'Habiba', preferredTime: 'Tuesday at 3pm' },
      tool: 'create_appointment_request',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 403);
});

test('createConversationCaptureService persists callback handoff with speakAs script', async () => {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: unknown[] = [];

  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
              update(payload: unknown) {
                updates.push(payload);
                return {
                  eq() {
                    return {
                      eq() {
                        return Promise.resolve({ error: null });
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: {
                                  capture_appointments: false,
                                  capture_leads: false,
                                  capture_messages: false,
                                  offer_handoff: true,
                                },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
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
                    return {
                      async maybeSingle() {
                        return {
                          data: {
                            handoff_destination_type: 'callback',
                            handoff_destination_value: null,
                            handoff_script:
                              'I can have someone from the team call you back.',
                            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'conversation_captures') {
            return {
              insert(payload: Record<string, unknown>) {
                inserts.push(payload);
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: {
                            capture_type: 'handoff_request',
                            id: 'cccccccc-1000-4000-8000-000000000003',
                            status: 'requested',
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: {
        reason: 'Wants to speak with a receptionist',
        callerName: 'Habiba',
        callbackPhone: '03055780214',
      },
      idempotencyKey: 'handoff-1',
      tool: 'offer_human_handoff',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 200);
  if (!('result' in result.body) || !result.body.result || !result.body.result.ok) {
    assert.fail('expected successful handoff capture result');
  }
  assert.equal(result.body.result.captureType, 'handoff_request');
  assert.equal(result.body.result.status, 'requested');
  assert.match(
    result.body.result.speakAs ?? '',
    /someone from the team call you back/i,
  );
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.capture_type, 'handoff_request');
  assert.equal(inserts[0]?.status, 'requested');
  assert.deepEqual(updates[0], { outcome: 'handoff_requested' });
});

test('createConversationCaptureService substitutes phone_info destination in speakAs', async () => {
  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
              update() {
                return {
                  eq() {
                    return {
                      eq() {
                        return Promise.resolve({ error: null });
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: { offer_handoff: true },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
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
                    return {
                      async maybeSingle() {
                        return {
                          data: {
                            handoff_destination_type: 'phone_info',
                            handoff_destination_value: '555-0199',
                            handoff_script: 'Please call us at {destination}.',
                            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'conversation_captures') {
            return {
              insert() {
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: {
                            capture_type: 'handoff_request',
                            id: 'cccccccc-1000-4000-8000-000000000004',
                            status: 'requested',
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: { reason: 'Needs the front desk number' },
      tool: 'offer_human_handoff',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 200);
  if (!('result' in result.body) || !result.body.result || !result.body.result.ok) {
    assert.fail('expected successful phone_info handoff');
  }
  assert.match(result.body.result.speakAs ?? '', /555-0199/);
});

test('createConversationCaptureService denies handoff when destination is none', async () => {
  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: { offer_handoff: true },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
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
                    return {
                      async maybeSingle() {
                        return {
                          data: {
                            handoff_destination_type: 'none',
                            handoff_destination_value: null,
                            handoff_script: null,
                            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: { reason: 'Wants a human' },
      tool: 'offer_human_handoff',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 403);
});

test('createConversationCaptureService returns existing capture on idempotency conflict', async () => {
  let insertAttempts = 0;

  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
              update() {
                return {
                  eq() {
                    return {
                      eq() {
                        return Promise.resolve({ error: null });
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: { capture_leads: true, lead_fields: ['name'] },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'conversation_captures') {
            return {
              insert() {
                insertAttempts += 1;
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: null,
                          error: {
                            code: '23505',
                            message: 'duplicate key value violates unique constraint',
                          },
                        };
                      },
                    };
                  },
                };
              },
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          eq() {
                            return {
                              async maybeSingle() {
                                return {
                                  data: {
                                    capture_type: 'lead',
                                    id: 'cccccccc-1000-4000-8000-000000000099',
                                    status: 'captured',
                                  },
                                  error: null,
                                };
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: { name: 'Habiba' },
      idempotencyKey: 'lead-dup',
      tool: 'capture_lead',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 200);
  assert.equal(insertAttempts, 1);
  if (!('result' in result.body) || !result.body.result || !result.body.result.ok) {
    assert.fail('expected successful capture result');
  }
  assert.equal(result.body.result.captureId, 'cccccccc-1000-4000-8000-000000000099');
});

test('createConversationCaptureService returns 404 when conversation agent does not match token', async () => {
  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return { data: null, error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: { args: { name: 'Habiba' }, tool: 'capture_lead' },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 404);
});

test('createConversationCaptureService rejects completed conversations', async () => {
  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: 'lead_captured',
                                source: 'browser_test',
                                status: 'completed',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: { args: { name: 'Habiba' }, tool: 'capture_lead' },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 409);
});

test('createConversationCaptureService denies message and handoff tools when capabilities are off', async () => {
  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: {
                                  capture_appointments: false,
                                  capture_leads: true,
                                  capture_messages: false,
                                  offer_handoff: false,
                                },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const messageResult = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: { message: 'Please call me back.' },
      tool: 'capture_message',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });
  const handoffResult = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: { reason: 'Wants a person' },
      tool: 'offer_human_handoff',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(messageResult.status, 403);
  assert.equal(handoffResult.status, 403);
});

test('createConversationCaptureService writes tenant_id from the conversation for inserts', async () => {
  const inserts: Array<Record<string, unknown>> = [];

  const createCapture = createConversationCaptureService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          if (table === 'conversations') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                                outcome: null,
                                source: 'browser_test',
                                status: 'active',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
              update() {
                return {
                  eq() {
                    return {
                      eq() {
                        return Promise.resolve({ error: null });
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'agents') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: {
                                capabilities: { capture_leads: true, lead_fields: ['name'] },
                                id: 'aaaaaaaa-2000-4000-8000-000000000001',
                                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                              },
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          if (table === 'conversation_captures') {
            return {
              insert(payload: Record<string, unknown>) {
                inserts.push(payload);
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: {
                            capture_type: 'lead',
                            id: 'cccccccc-1000-4000-8000-000000000020',
                            status: 'captured',
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          throw new Error(`unexpected table ${table}`);
        },
      }) as never,
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role',
      supabaseUrl: 'https://example.supabase.co',
    }),
    verifyVoiceSessionToken: async () => ({
      claims: voiceClaims('aaaaaaaa-5000-4000-8000-000000000001'),
      ok: true as const,
    }),
  });

  const result = await createCapture({
    authorizationHeader: 'Bearer token',
    body: {
      args: { name: 'Habiba' },
      tool: 'capture_lead',
    },
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
  });

  assert.equal(result.status, 200);
  assert.equal(inserts[0]?.tenant_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  assert.equal(
    inserts[0]?.conversation_id,
    'aaaaaaaa-5000-4000-8000-000000000001',
  );
});
