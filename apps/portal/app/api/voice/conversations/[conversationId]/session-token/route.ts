import {
  issueVoiceSessionToken,
} from '../../../../../../lib/voice/issue-session-token';
import { createIssueVoiceSessionTokenRouteHandler } from '../../../../../../lib/voice/issue-session-token-route';

export const POST = createIssueVoiceSessionTokenRouteHandler(
  issueVoiceSessionToken,
);
