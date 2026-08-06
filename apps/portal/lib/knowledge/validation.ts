import {
  businessKnowledgeKinds,
  businessKnowledgeStatuses,
  emptyBusinessKnowledgeValues,
  type BusinessKnowledgeKind,
  type BusinessKnowledgeStatus,
  type BusinessKnowledgeValues,
} from './schema';

export type BusinessKnowledgeActionState = {
  message: string | null;
  status: 'error' | 'idle' | 'success';
  values: BusinessKnowledgeValues;
};

export type BusinessKnowledgeValidationResult =
  | {
      errors: string[];
      values: BusinessKnowledgeValues;
    }
  | {
      data: {
        content: string;
        kind: BusinessKnowledgeKind;
        status: BusinessKnowledgeStatus;
        title: string;
      };
      values: BusinessKnowledgeValues;
    };

function normalizeText(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isKnowledgeKind(value: string): value is BusinessKnowledgeKind {
  return businessKnowledgeKinds.includes(value as BusinessKnowledgeKind);
}

function isKnowledgeStatus(value: string): value is BusinessKnowledgeStatus {
  return businessKnowledgeStatuses.includes(value as BusinessKnowledgeStatus);
}

export function initialBusinessKnowledgeActionState(
  values: BusinessKnowledgeValues,
): BusinessKnowledgeActionState {
  return {
    message: null,
    status: 'idle',
    values,
  };
}

export function parseBusinessKnowledgeForm(
  formData: FormData,
): BusinessKnowledgeValidationResult {
  const values = emptyBusinessKnowledgeValues();
  const errors: string[] = [];

  values.title = normalizeText(formData.get('title'));
  values.content = normalizeText(formData.get('content'));

  const kind = normalizeText(formData.get('kind'));
  const status = normalizeText(formData.get('status'));

  values.kind = isKnowledgeKind(kind) ? kind : 'faq';
  values.status = isKnowledgeStatus(status) ? status : 'draft';

  if (!values.title) {
    errors.push('Knowledge title is required.');
  }

  if (!values.content) {
    errors.push('Knowledge content is required.');
  }

  if (!isKnowledgeKind(kind)) {
    errors.push(
      'Knowledge type must be FAQ, policy, business fact, or service information.',
    );
  }

  if (!isKnowledgeStatus(status)) {
    errors.push('Knowledge status must be draft, approved, or disabled.');
  }

  if (values.title.length > 160) {
    errors.push('Knowledge title must be 160 characters or fewer.');
  }

  if (errors.length > 0) {
    return {
      errors,
      values,
    };
  }

  return {
    data: {
      content: values.content,
      kind: values.kind,
      status: values.status,
      title: values.title,
    },
    values,
  };
}

