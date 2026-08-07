import '../supabase/server-only';

import { randomUUID } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';

import { isConversationUuid } from '../conversations/helpers';
import {
  browserConversationSource,
  type BrowserConversationSource,
} from './start-conversation';

export const VOICE_SESSION_TOKEN_ALGORITHM = 'HS256' as const;
export const VOICE_SESSION_TOKEN_AUDIENCE =
  'sleek-relay-voice-worker' as const;
export const VOICE_SESSION_TOKEN_CLOCK_SKEW_SECONDS = 30 as const;
export const VOICE_SESSION_TOKEN_DEFAULT_TTL_SECONDS = 1800;
export const VOICE_SESSION_TOKEN_ISSUER = 'sleek-relay-portal' as const;
export const VOICE_SESSION_TOKEN_MAX_TTL_SECONDS = 3600;
export const VOICE_SESSION_TOKEN_MIN_SECRET_BYTES = 32 as const;
export const VOICE_SESSION_TOKEN_MIN_TTL_SECONDS = 300;
export const VOICE_SESSION_TOKEN_PURPOSE = 'voice-session' as const;
export const VOICE_SESSION_TOKEN_VERSION = 1 as const;

export type VoiceSessionTokenClaims = {
  agentId: string;
  audience: typeof VOICE_SESSION_TOKEN_AUDIENCE;
  conversationId: string;
  expiresAt: string;
  issuedAt: string;
  issuer: typeof VOICE_SESSION_TOKEN_ISSUER;
  purpose: typeof VOICE_SESSION_TOKEN_PURPOSE;
  source: BrowserConversationSource;
  subject: string;
  tokenId: string;
  version: typeof VOICE_SESSION_TOKEN_VERSION;
};

type VoiceSessionSigningConfig = {
  algorithm: typeof VOICE_SESSION_TOKEN_ALGORITHM;
  audience: typeof VOICE_SESSION_TOKEN_AUDIENCE;
  clockSkewSeconds: number;
  issuer: typeof VOICE_SESSION_TOKEN_ISSUER;
  secret: Uint8Array;
  ttlSeconds: number;
};

type VerifyVoiceSessionTokenResult =
  | {
      claims: VoiceSessionTokenClaims;
      ok: true;
    }
  | {
      error: 'Invalid voice session token.';
      ok: false;
    };

type BearerAuthorizationHeaderResult =
  | {
      ok: true;
      token: string;
    }
  | {
      error:
        | 'Authorization header is required.'
        | 'Authorization header must use the Bearer scheme.'
        | 'Authorization header must contain a bearer token.';
      ok: false;
    };

type SignVoiceSessionTokenResult = {
  expiresAt: string;
  token: string;
};

const encoder = new TextEncoder();

function buildInvalidVoiceSessionTokenResult(): VerifyVoiceSessionTokenResult {
  return {
    error: 'Invalid voice session token.',
    ok: false,
  };
}

function readVoiceSessionSigningSecret(): Uint8Array {
  const value = process.env.VOICE_SESSION_SIGNING_SECRET;

  if (!value) {
    throw new Error(
      'Missing required environment variable: VOICE_SESSION_SIGNING_SECRET',
    );
  }

  const secret = encoder.encode(value);

  if (secret.byteLength < VOICE_SESSION_TOKEN_MIN_SECRET_BYTES) {
    throw new Error(
      `VOICE_SESSION_SIGNING_SECRET must be at least ${VOICE_SESSION_TOKEN_MIN_SECRET_BYTES} bytes long.`,
    );
  }

  return secret;
}

function validateVoiceSessionTokenTtl(ttlSeconds: number): number {
  if (ttlSeconds < VOICE_SESSION_TOKEN_MIN_TTL_SECONDS) {
    return VOICE_SESSION_TOKEN_MIN_TTL_SECONDS;
  }

  if (ttlSeconds > VOICE_SESSION_TOKEN_MAX_TTL_SECONDS) {
    return VOICE_SESSION_TOKEN_MAX_TTL_SECONDS;
  }

  return ttlSeconds;
}

function isSupportedVoiceSessionSource(
  value: unknown,
): value is BrowserConversationSource {
  return value === browserConversationSource;
}

function isPositiveUnixTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

function buildVoiceSessionTokenClaims(args: {
  agentId: string;
  conversationId: string;
  expiresAtSeconds: number;
  issuedAtSeconds: number;
  tokenId: string;
}): VoiceSessionTokenClaims {
  return {
    agentId: args.agentId,
    audience: VOICE_SESSION_TOKEN_AUDIENCE,
    conversationId: args.conversationId,
    expiresAt: new Date(args.expiresAtSeconds * 1000).toISOString(),
    issuedAt: new Date(args.issuedAtSeconds * 1000).toISOString(),
    issuer: VOICE_SESSION_TOKEN_ISSUER,
    purpose: VOICE_SESSION_TOKEN_PURPOSE,
    source: browserConversationSource,
    subject: args.conversationId,
    tokenId: args.tokenId,
    version: VOICE_SESSION_TOKEN_VERSION,
  };
}

function validateVoiceSessionTokenInputs(args: {
  agentId: string;
  conversationId: string;
}) {
  if (!isConversationUuid(args.conversationId)) {
    throw new Error('Voice session token conversation ID must be a valid UUID.');
  }

  if (!isConversationUuid(args.agentId)) {
    throw new Error('Voice session token agent ID must be a valid UUID.');
  }
}

export function getVoiceSessionSigningConfig(): VoiceSessionSigningConfig {
  return {
    algorithm: VOICE_SESSION_TOKEN_ALGORITHM,
    audience: VOICE_SESSION_TOKEN_AUDIENCE,
    clockSkewSeconds: VOICE_SESSION_TOKEN_CLOCK_SKEW_SECONDS,
    issuer: VOICE_SESSION_TOKEN_ISSUER,
    secret: readVoiceSessionSigningSecret(),
    ttlSeconds: validateVoiceSessionTokenTtl(
      VOICE_SESSION_TOKEN_DEFAULT_TTL_SECONDS,
    ),
  };
}

export async function signVoiceSessionToken(args: {
  agentId: string;
  conversationId: string;
  now: Date;
}): Promise<SignVoiceSessionTokenResult> {
  validateVoiceSessionTokenInputs(args);

  const config = getVoiceSessionSigningConfig();
  const issuedAtSeconds = Math.floor(args.now.getTime() / 1000);
  const expiresAtSeconds = issuedAtSeconds + config.ttlSeconds;

  if (expiresAtSeconds <= issuedAtSeconds) {
    throw new Error('Voice session token expiry configuration is invalid.');
  }

  const tokenId = randomUUID();

  const token = await new SignJWT({
    agentId: args.agentId,
    conversationId: args.conversationId,
    purpose: VOICE_SESSION_TOKEN_PURPOSE,
    source: browserConversationSource,
    version: VOICE_SESSION_TOKEN_VERSION,
  })
    .setProtectedHeader({
      alg: config.algorithm,
      typ: 'JWT',
    })
    .setSubject(args.conversationId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setJti(tokenId)
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(config.secret);

  return {
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    token,
  };
}

export async function verifyVoiceSessionToken(
  token: string,
  args?: {
    currentDate?: Date;
  },
): Promise<VerifyVoiceSessionTokenResult> {
  if (!token || typeof token !== 'string') {
    return buildInvalidVoiceSessionTokenResult();
  }

  try {
    const config = getVoiceSessionSigningConfig();
    const { payload, protectedHeader } = await jwtVerify(token, config.secret, {
      algorithms: [config.algorithm],
      audience: config.audience,
      clockTolerance: config.clockSkewSeconds,
      currentDate: args?.currentDate,
      issuer: config.issuer,
    });

    if (protectedHeader.alg !== config.algorithm) {
      return buildInvalidVoiceSessionTokenResult();
    }

    const conversationId = payload.conversationId;
    const agentId = payload.agentId;
    const tokenId = payload.jti;
    const issuedAtSeconds = payload.iat;
    const expiresAtSeconds = payload.exp;

    if (
      typeof payload.sub !== 'string' ||
      typeof conversationId !== 'string' ||
      payload.sub !== conversationId ||
      !isConversationUuid(conversationId)
    ) {
      return buildInvalidVoiceSessionTokenResult();
    }

    if (
      typeof agentId !== 'string' ||
      !isConversationUuid(agentId) ||
      !isPositiveUnixTimestamp(issuedAtSeconds) ||
      !isPositiveUnixTimestamp(expiresAtSeconds) ||
      expiresAtSeconds <= issuedAtSeconds
    ) {
      return buildInvalidVoiceSessionTokenResult();
    }

    if (
      payload.iss !== config.issuer ||
      payload.aud !== config.audience ||
      payload.purpose !== VOICE_SESSION_TOKEN_PURPOSE ||
      payload.version !== VOICE_SESSION_TOKEN_VERSION ||
      !isSupportedVoiceSessionSource(payload.source) ||
      typeof tokenId !== 'string' ||
      !tokenId.trim()
    ) {
      return buildInvalidVoiceSessionTokenResult();
    }

    return {
      claims: buildVoiceSessionTokenClaims({
        agentId,
        conversationId,
        expiresAtSeconds,
        issuedAtSeconds,
        tokenId,
      }),
      ok: true,
    };
  } catch {
    return buildInvalidVoiceSessionTokenResult();
  }
}

export function parseBearerAuthorizationHeader(
  headerValue: string | null | undefined,
): BearerAuthorizationHeaderResult {
  if (!headerValue) {
    return {
      error: 'Authorization header is required.',
      ok: false,
    };
  }

  const trimmedValue = headerValue.trim();

  if (!trimmedValue) {
    return {
      error: 'Authorization header is required.',
      ok: false,
    };
  }

  const [scheme, token, ...rest] = trimmedValue.split(/\s+/);

  if (!scheme || scheme.toLowerCase() !== 'bearer') {
    return {
      error: 'Authorization header must use the Bearer scheme.',
      ok: false,
    };
  }

  if (!token || rest.length > 0) {
    return {
      error: 'Authorization header must contain a bearer token.',
      ok: false,
    };
  }

  return {
    ok: true,
    token,
  };
}
