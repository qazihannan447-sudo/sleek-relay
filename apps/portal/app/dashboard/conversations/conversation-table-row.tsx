'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type ConversationTableRowProps = {
  children: ReactNode;
  conversationId: string;
  isSelected?: boolean;
};

export function ConversationTableRow({
  children,
  conversationId,
  isSelected = false,
}: ConversationTableRowProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const openDrawer = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('conversationId', conversationId);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <tr
      className={`clickable-row ${isSelected ? 'row-selected' : ''}`}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('a, button, input, select, textarea')) {
          return;
        }

        if (event.ctrlKey || event.metaKey) {
          const detailUrl = `${pathname}?conversationId=${conversationId}`;
          window.open(detailUrl, '_blank');
        } else {
          openDrawer();
        }
      }}
    >
      {children}
    </tr>
  );
}
