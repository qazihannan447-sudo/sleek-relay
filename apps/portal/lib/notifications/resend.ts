export type ResendConfig = {
  apiKey: string;
  fromEmail: string;
};

export type ResendSendResult =
  | {
      messageId: string;
      ok: true;
    }
  | {
      errorMessage: string;
      ok: false;
    };

const DEFAULT_FROM_EMAIL = 'Sleek Relay <notifications@admin.awaazlabs.io>';
const RESEND_API_URL = 'https://api.resend.com/emails';

export function loadResendConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const fromEmail = env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL;

  return {
    apiKey,
    fromEmail,
  };
}

export async function sendResendEmail(args: {
  config: ResendConfig;
  fetchImpl?: typeof fetch;
  html?: string;
  subject: string;
  text: string;
  to: string;
}): Promise<ResendSendResult> {
  const fetchImpl = args.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(RESEND_API_URL, {
      body: JSON.stringify({
        from: args.config.fromEmail,
        html: args.html,
        subject: args.subject,
        text: args.text,
        to: [args.to],
      }),
      headers: {
        Authorization: `Bearer ${args.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
      name?: string;
    } | null;

    if (!response.ok) {
      return {
        errorMessage:
          payload?.message?.trim() ||
          `Resend request failed with status ${response.status}.`,
        ok: false,
      };
    }

    const messageId = payload?.id?.trim();
    if (!messageId) {
      return {
        errorMessage: 'Resend response did not include a message id.',
        ok: false,
      };
    }

    return {
      messageId,
      ok: true,
    };
  } catch (error) {
    return {
      errorMessage:
        error instanceof Error
          ? error.message
          : 'Unable to reach Resend right now.',
      ok: false,
    };
  }
}
