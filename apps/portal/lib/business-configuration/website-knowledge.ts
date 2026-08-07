import type { BusinessKnowledgeKind } from '../knowledge/schema';
import type {
  ExtractionFieldProvenance,
  WebsiteExtractionDraftView,
} from './website-extraction';

export type WebsiteKnowledgeCandidate = {
  confidence: ExtractionFieldProvenance['confidence'];
  content: string;
  key: string;
  kind: BusinessKnowledgeKind;
  source: ExtractionFieldProvenance['source'];
  title: string;
};

const TITLE_MAX = 160;

function truncateTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= TITLE_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

function pushCandidate(
  out: WebsiteKnowledgeCandidate[],
  candidate: WebsiteKnowledgeCandidate,
) {
  if (!candidate.title.trim() || !candidate.content.trim()) {
    return;
  }
  out.push({
    ...candidate,
    content: candidate.content.trim(),
    title: truncateTitle(candidate.title),
  });
}

function policyTitle(policy: string, index: number): string {
  const cleaned = policy.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return `Policy ${index + 1}`;
  }

  const firstSentence =
    cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() || cleaned;
  if (firstSentence.length <= 80) {
    return firstSentence;
  }

  return `${firstSentence.slice(0, 79).trimEnd()}…`;
}

export function draftToKnowledgeCandidates(
  draft: WebsiteExtractionDraftView,
): WebsiteKnowledgeCandidate[] {
  const { fields } = draft;
  const out: WebsiteKnowledgeCandidate[] = [];

  if (fields.summary) {
    pushCandidate(out, {
      confidence: fields.summary.confidence,
      content: fields.summary.value,
      key: 'summary',
      kind: 'business_fact',
      source: fields.summary.source,
      title: 'Business summary',
    });
  }

  if (fields.address) {
    pushCandidate(out, {
      confidence: fields.address.confidence,
      content: fields.address.value,
      key: 'address',
      kind: 'business_fact',
      source: fields.address.source,
      title: 'Business address',
    });
  }

  if (fields.services) {
    fields.services.value.forEach((service, index) => {
      pushCandidate(out, {
        confidence: fields.services!.confidence,
        content: service.description?.trim() || service.name,
        key: `service:${index}:${service.name}`,
        kind: 'service_information',
        source: fields.services!.source,
        title: service.name,
      });
    });
  }

  if (fields.faqs) {
    fields.faqs.value.forEach((faq, index) => {
      pushCandidate(out, {
        confidence: fields.faqs!.confidence,
        content: faq.answer,
        key: `faq:${index}:${faq.question}`,
        kind: 'faq',
        source: fields.faqs!.source,
        title: faq.question,
      });
    });
  }

  if (fields.policies) {
    fields.policies.value.forEach((policy, index) => {
      pushCandidate(out, {
        confidence: fields.policies!.confidence,
        content: policy,
        key: `policy:${index}`,
        kind: 'policy',
        source: fields.policies!.source,
        title: policyTitle(policy, index),
      });
    });
  }

  if (fields.projects) {
    fields.projects.value.forEach((project, index) => {
      const parts = [project.description?.trim(), project.url].filter(Boolean);
      pushCandidate(out, {
        confidence: fields.projects!.confidence,
        content: parts.length > 0 ? parts.join('\n') : project.name,
        key: `project:${index}:${project.name}`,
        kind: 'business_fact',
        source: fields.projects!.source,
        title: `Project: ${project.name}`,
      });
    });
  }

  if (fields.partners) {
    fields.partners.value.forEach((partner, index) => {
      pushCandidate(out, {
        confidence: fields.partners!.confidence,
        content: partner.url?.trim() || partner.name,
        key: `partner:${index}:${partner.name}`,
        kind: 'business_fact',
        source: fields.partners!.source,
        title: `Partner: ${partner.name}`,
      });
    });
  }

  if (fields.socialLinks) {
    fields.socialLinks.value.forEach((link, index) => {
      pushCandidate(out, {
        confidence: fields.socialLinks!.confidence,
        content: link,
        key: `social:${index}:${link}`,
        kind: 'business_fact',
        source: fields.socialLinks!.source,
        title: `Social link: ${link}`,
      });
    });
  }

  return out;
}

export function draftHasKnowledgeContent(
  draft: WebsiteExtractionDraftView,
): boolean {
  return draftToKnowledgeCandidates(draft).length > 0;
}
