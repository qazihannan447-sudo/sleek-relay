import {
  createIssueVoiceRuntimeConfigRouteHandler,
  issueVoiceRuntimeConfig,
} from '../../../../lib/voice/runtime-config';

export const POST = createIssueVoiceRuntimeConfigRouteHandler(
  issueVoiceRuntimeConfig,
);
