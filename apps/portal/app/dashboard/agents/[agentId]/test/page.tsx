import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type AgentVoiceTestPageProps = {
  params: Promise<{
    agentId: string;
  }>;
};

export default async function AgentVoiceTestPage({
  params,
}: AgentVoiceTestPageProps) {
  const { agentId } = await params;
  redirect(`/dashboard/agents/${agentId}?test=true`);
}

