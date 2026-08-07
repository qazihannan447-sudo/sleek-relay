import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type ConversationDetailPageProps = {
  params: Promise<{
    conversationId: string;
  }>;
};

export default async function ConversationDetailPage({
  params,
}: ConversationDetailPageProps) {
  const { conversationId } = await params;
  redirect(`/dashboard/conversations?conversationId=${encodeURIComponent(conversationId)}`);
}
