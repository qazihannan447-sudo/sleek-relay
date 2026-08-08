export type BehaviorTemplateValues = {
  agentName?: string | null;
  businessName?: string | null;
  callerName?: string | null;
};

const TEMPLATE_TOKENS = [
  '{Business Name}',
  '{Agent Name}',
  '{Caller Name}',
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
