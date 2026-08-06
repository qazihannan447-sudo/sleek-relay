'use client';

import { useActionState } from 'react';

import { saveBusinessKnowledge } from './actions';
import { type BusinessKnowledgeValues } from '../../../lib/knowledge/schema';
import {
  initialBusinessKnowledgeActionState,
  type BusinessKnowledgeActionState,
} from '../../../lib/knowledge/validation';

type KnowledgeFormProps = {
  canEdit: boolean;
  defaultValues: BusinessKnowledgeValues;
  itemId: string | null;
};

function getFieldValues(
  state: BusinessKnowledgeActionState,
  fallback: BusinessKnowledgeValues,
): BusinessKnowledgeValues {
  return state.values ?? fallback;
}

export function KnowledgeForm({
  canEdit,
  defaultValues,
  itemId,
}: KnowledgeFormProps) {
  const [state, formAction, isPending] = useActionState<
    BusinessKnowledgeActionState,
    FormData
  >(saveBusinessKnowledge, initialBusinessKnowledgeActionState(defaultValues));
  const values = getFieldValues(state, defaultValues);

  return (
    <form action={formAction} className="business-form">
      <input name="itemId" type="hidden" value={itemId ?? ''} />

      <div className="business-form-grid">
        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            defaultValue={values.title}
            disabled={!canEdit || isPending}
            id="title"
            name="title"
            required
            type="text"
          />
        </div>

        <div className="field">
          <label htmlFor="kind">Knowledge type</label>
          <select
            defaultValue={values.kind}
            disabled={!canEdit || isPending}
            id="kind"
            name="kind"
          >
            <option value="faq">FAQ</option>
            <option value="policy">Policy</option>
            <option value="business_fact">Business Fact</option>
            <option value="service_information">Service Information</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="status">Status</label>
          <select
            defaultValue={values.status}
            disabled={!canEdit || isPending}
            id="status"
            name="status"
          >
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="content">Content</label>
        <textarea
          defaultValue={values.content}
          disabled={!canEdit || isPending}
          id="content"
          name="content"
          rows={8}
        />
      </div>

      <div className="notice">
        Only approved knowledge becomes part of the future voice runtime
        package. Draft and disabled records stay out of the runtime payload.
      </div>

      {state.message ? (
        <div
          className={
            state.status === 'success'
              ? 'notice notice-success'
              : 'notice notice-danger'
          }
        >
          {state.message}
        </div>
      ) : null}

      {canEdit ? (
        <button className="button" disabled={isPending} type="submit">
          {isPending
            ? 'Saving...'
            : itemId
              ? 'Save knowledge'
              : 'Create knowledge'}
        </button>
      ) : (
        <div className="notice">
          You have read-only access. Owners and admins may manage business
          knowledge records.
        </div>
      )}
    </form>
  );
}

