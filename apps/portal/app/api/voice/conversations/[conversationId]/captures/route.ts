import {
  createConversationCaptureRouteHandler,
  createConversationCapture,
} from '../../../../../../lib/voice/captures';

export const POST = createConversationCaptureRouteHandler(
  createConversationCapture,
);
