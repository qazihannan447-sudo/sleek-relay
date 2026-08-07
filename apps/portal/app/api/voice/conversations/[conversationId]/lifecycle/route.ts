import {
  createBrowserConversationLifecycleRouteHandler,
} from '../../../../../../lib/voice/conversation-lifecycle-route';
import {
  parseBrowserConversationLifecycleJsonRequest,
  updateBrowserConversationLifecycle,
} from '../../../../../../lib/voice/conversation-lifecycle';

export const PATCH = createBrowserConversationLifecycleRouteHandler(
  async ({ conversationId, request }) => {
    const parsed = await parseBrowserConversationLifecycleJsonRequest(request);

    if (!parsed.ok) {
      return {
        body: parsed.body,
        headers: {
          'Cache-Control': 'no-store',
        },
        status: parsed.status,
      };
    }

    return updateBrowserConversationLifecycle({
      conversationId,
      request: parsed.data,
    });
  },
);
