export const businessKnowledgeKinds = [
  'faq',
  'policy',
  'business_fact',
  'service_information',
] as const;

export const businessKnowledgeStatuses = [
  'draft',
  'approved',
  'disabled',
] as const;

export type BusinessKnowledgeKind = (typeof businessKnowledgeKinds)[number];
export type BusinessKnowledgeStatus =
  (typeof businessKnowledgeStatuses)[number];

export type BusinessKnowledgeValues = {
  content: string;
  kind: BusinessKnowledgeKind;
  status: BusinessKnowledgeStatus;
  title: string;
};

export type BusinessKnowledgeRecord = {
  content: string;
  id: string;
  kind: BusinessKnowledgeKind;
  status: BusinessKnowledgeStatus;
  title: string;
  updated_at: string;
};

export type BusinessKnowledgeListItem = {
  id: string;
  kind: BusinessKnowledgeKind;
  lastUpdated: string;
  status: BusinessKnowledgeStatus;
  title: string;
};

export function emptyBusinessKnowledgeValues(): BusinessKnowledgeValues {
  return {
    content: '',
    kind: 'faq',
    status: 'draft',
    title: '',
  };
}

export function businessKnowledgeRecordToValues(
  record: BusinessKnowledgeRecord,
): BusinessKnowledgeValues {
  return {
    content: record.content,
    kind: record.kind,
    status: record.status,
    title: record.title,
  };
}

