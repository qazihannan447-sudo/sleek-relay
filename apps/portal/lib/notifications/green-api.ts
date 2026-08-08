export type GreenApiConfig = {
  apiTokenInstance: string;
  apiUrl: string;
  idInstance: string;
};

export type GreenApiSendResult =
  | {
      messageId: string;
      ok: true;
    }
  | {
      errorMessage: string;
      ok: false;
    };

export function loadGreenApiConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GreenApiConfig | null {
  const idInstance = env.GREEN_API_INSTANCE_ID?.trim();
  const apiTokenInstance = env.GREEN_API_TOKEN?.trim();
  const apiUrl = (
    env.GREEN_API_URL?.trim() || 'https://api.green-api.com'
  ).replace(/\/$/, '');

  if (!idInstance || !apiTokenInstance) {
    return null;
  }

  return {
    apiTokenInstance,
    apiUrl,
    idInstance,
  };
}

export function normalizeWhatsAppChatId(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return `${digits}@c.us`;
}

export async function sendGreenApiWhatsAppMessage(args: {
  chatId: string;
  config: GreenApiConfig;
  fetchImpl?: typeof fetch;
  message: string;
}): Promise<GreenApiSendResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `${args.config.apiUrl}/waInstance${args.config.idInstance}/sendMessage/${args.config.apiTokenInstance}`;

  try {
    const response = await fetchImpl(url, {
      body: JSON.stringify({
        chatId: args.chatId,
        message: args.message,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    const payload = (await response.json().catch(() => null)) as {
      idMessage?: string;
      message?: string;
    } | null;

    if (!response.ok) {
      return {
        errorMessage:
          payload?.message?.trim() ||
          `Green API request failed with status ${response.status}.`,
        ok: false,
      };
    }

    const messageId = payload?.idMessage?.trim();
    if (!messageId) {
      return {
        errorMessage: 'Green API response did not include a message id.',
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
          : 'Unable to reach Green API right now.',
      ok: false,
    };
  }
}
