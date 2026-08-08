import OpenAI from 'openai';

const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_SUMMARY_LENGTH = 1_000;
const MAX_TRANSCRIPT_CHARS = 12_000;
/** Background generation budget; finalize no longer awaits this path. */
const SUMMARY_TIMEOUT_MS = 12_000;

export type ConversationSummaryMessage = {
  content: string;
  role: 'assistant' | 'system' | 'user';
};

export type ConversationSummaryLlmConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

type GenerateConversationSummaryDeps = {
  complete?: (_args: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
  }) => Promise<string>;
  loadConfig?: () => ConversationSummaryLlmConfig | null;
};

export function loadConversationSummaryLlmConfig(
  env: Record<string, string | undefined> = process.env,
): ConversationSummaryLlmConfig | null {
  const apiKey =
    env.GOOGLE_API_KEY?.trim() || env.GEMINI_API_KEY?.trim() || undefined;
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseURL:
      env.GEMINI_BASE_URL?.trim() ||
      env.GOOGLE_OPENAI_BASE_URL?.trim() ||
      DEFAULT_GEMINI_BASE_URL,
    model:
      env.GOOGLE_MODEL?.trim() ||
      env.GEMINI_MODEL?.trim() ||
      DEFAULT_GEMINI_MODEL,
  };
}

export function formatTranscriptForSummary(
  messages: ConversationSummaryMessage[],
): string {
  const lines: string[] = [];

  for (const message of messages) {
    const content = message.content.trim();
    if (!content) {
      continue;
    }

    const speaker =
      message.role === 'user'
        ? 'Caller'
        : message.role === 'assistant'
          ? 'Agent'
          : 'System';
    lines.push(`${speaker}: ${content}`);
  }

  const joined = lines.join('\n');
  if (joined.length <= MAX_TRANSCRIPT_CHARS) {
    return joined;
  }

  return `${joined.slice(0, MAX_TRANSCRIPT_CHARS - 3).trimEnd()}...`;
}

export function buildConversationSummaryPrompts(args: {
  endReason?: string;
  event: 'completed' | 'failed';
  transcriptMessages: ConversationSummaryMessage[];
}): { systemPrompt: string; userPrompt: string } {
  const transcript = formatTranscriptForSummary(args.transcriptMessages);
  const systemPrompt = [
    'You write short post-call summaries for business voice-agent test sessions.',
    'Write 2-4 plain English sentences.',
    'Use only the provided transcript and session metadata.',
    'Do not invent business hours, services, prices, policies, availability, or outcomes that are not clearly stated.',
    'Do not mention prompts, tools, APIs, models, or implementation details.',
    'If the transcript is empty or unusable, say the session ended without a usable transcript.',
  ].join(' ');

  const userPrompt = [
    `Session event: ${args.event}`,
    `End reason: ${args.endReason?.trim() || 'not provided'}`,
    'Transcript:',
    transcript || '(no transcript messages)',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function truncateSummary(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= MAX_SUMMARY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, MAX_SUMMARY_LENGTH - 3)).trimEnd()}...`;
}

function createDefaultComplete(config: ConversationSummaryLlmConfig) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  return async function complete(args: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

    try {
      const completion = await client.chat.completions.create(
        {
          messages: [
            { content: args.systemPrompt, role: 'system' },
            { content: args.userPrompt, role: 'user' },
          ],
          model: args.model,
          temperature: 0.2,
        },
        { signal: controller.signal },
      );

      return completion.choices[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timeout);
    }
  };
}

export async function generateConversationSummaryFromTranscript(
  args: {
    endReason?: string;
    event: 'completed' | 'failed';
    transcriptMessages: ConversationSummaryMessage[];
  },
  deps: GenerateConversationSummaryDeps = {},
): Promise<string | null> {
  const loadConfig = deps.loadConfig ?? loadConversationSummaryLlmConfig;
  const config = loadConfig();
  if (!config) {
    return null;
  }

  if (args.transcriptMessages.length === 0) {
    return null;
  }

  const { systemPrompt, userPrompt } = buildConversationSummaryPrompts(args);
  const complete = deps.complete ?? createDefaultComplete(config);

  try {
    const raw = await complete({
      model: config.model,
      systemPrompt,
      userPrompt,
    });
    const summary = truncateSummary(raw);
    return summary || null;
  } catch {
    return null;
  }
}

export function shouldReplaceConversationSummary(
  existingSummary: string | null | undefined,
): boolean {
  const trimmed = existingSummary?.trim();
  if (!trimmed) {
    return true;
  }

  return (
    trimmed.includes('Last agent reply:') ||
    trimmed.includes('First user message:') ||
    trimmed.startsWith('Browser voice test ')
  );
}
