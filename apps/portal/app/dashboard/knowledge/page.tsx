import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function BusinessKnowledgePage() {
  redirect('/dashboard/business');
}
