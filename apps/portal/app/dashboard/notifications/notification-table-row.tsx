'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type NotificationTableRowProps = {
  children: ReactNode;
  isSelected?: boolean;
  notificationId: string;
};

export function NotificationTableRow({
  children,
  isSelected = false,
  notificationId,
}: NotificationTableRowProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const openDrawer = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('conversationId');
    params.set('notificationId', notificationId);
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
          const detailUrl = `${pathname}?notificationId=${notificationId}`;
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
