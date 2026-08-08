export type BehaviorTemplateValues = {
  agentName?: string | null;
  businessName?: string | null;
  callerName?: string | null;
};

/** Tokens safe to substitute when building the pre-session runtime package. */
export const PRE_SESSION_BEHAVIOR_TEMPLATE_TOKENS = [
  '{Business Name}',
  '{Agent Name}',
] as const;

/**
 * Tokens that require a known caller identity. Not offered in pre-session
 * greeting/instructions UI because the runtime package is composed before the
 * caller is known.
 */
export const CALLER_BEHAVIOR_TEMPLATE_TOKEN = '{Caller Name}' as const;

const TEMPLATE_TOKENS = [
  ...PRE_SESSION_BEHAVIOR_TEMPLATE_TOKENS,
  CALLER_BEHAVIOR_TEMPLATE_TOKEN,
] as const;

function collapseEmptyTokenGaps(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .replace(/ +([,.;!?])/g, '$1');
}

export function applyAgentBehaviorTemplates(
  text: string,
  values: BehaviorTemplateValues,
): string {
  if (!text) {
    return '';
  }

  const replacements: Record<(typeof TEMPLATE_TOKENS)[number], string> = {
    '{Business Name}': values.businessName?.trim() ?? '',
    '{Agent Name}': values.agentName?.trim() ?? '',
    '{Caller Name}': values.callerName?.trim() ?? '',
  };

  let next = text;
  for (const token of TEMPLATE_TOKENS) {
    next = next.replaceAll(token, replacements[token]);
  }

  return collapseEmptyTokenGaps(next);
}

/**
 * Pre-session composition: substitute business/agent tokens only.
 * Always clears `{Caller Name}` so greetings/instructions never speak an empty
 * or literal unresolved caller placeholder before the caller is known.
 */
export function applyPreSessionAgentBehaviorTemplates(
  text: string,
  values: Pick<BehaviorTemplateValues, 'agentName' | 'businessName'>,
): string {
  return applyAgentBehaviorTemplates(text, {
    agentName: values.agentName,
    businessName: values.businessName,
    callerName: '',
  });
}
