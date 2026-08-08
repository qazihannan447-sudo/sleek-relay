import type { ReactNode } from 'react';

type IconProps = {
  children: ReactNode;
};

function IconFrame({ children }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
    >
      {children}
    </svg>
  );
}

export function RelayIcon() {
  return (
    <IconFrame>
      <path d="M6.5 7.5a3.5 3.5 0 0 1 6.1-2.3l4.2 4.3a3.5 3.5 0 1 1-4.9 5" />
      <path d="M17.5 16.5a3.5 3.5 0 0 1-6.1 2.3l-4.2-4.3a3.5 3.5 0 1 1 4.9-5" />
    </IconFrame>
  );
}

export function OverviewIcon() {
  return (
    <IconFrame>
      <rect height="6" rx="1.2" width="6" x="3.5" y="3.5" />
      <rect height="6" rx="1.2" width="10" x="10.5" y="3.5" />
      <rect height="10" rx="1.2" width="10" x="3.5" y="10.5" />
      <rect height="10" rx="1.2" width="6" x="14.5" y="10.5" />
    </IconFrame>
  );
}

export function BusinessIcon() {
  return (
    <IconFrame>
      <path d="M5 20.5V8.5l7-4 7 4v12" />
      <path d="M9 20.5v-5h6v5" />
      <path d="M9 10.5h.01" />
      <path d="M15 10.5h.01" />
    </IconFrame>
  );
}

export function KnowledgeIcon() {
  return (
    <IconFrame>
      <path d="M5.5 5.5A2.5 2.5 0 0 1 8 3h10.5v15.5H8A2.5 2.5 0 0 0 5.5 21z" />
      <path d="M5.5 5.5V21" />
      <path d="M9.5 7.5h6" />
      <path d="M9.5 11h6" />
      <path d="M9.5 14.5h4" />
    </IconFrame>
  );
}

export function AgentsIcon() {
  return (
    <IconFrame>
      <circle cx="9" cy="8" r="3" />
      <path d="M4.5 19a4.5 4.5 0 0 1 9 0" />
      <path d="M16 7.5a2.5 2.5 0 1 1 0 5" />
      <path d="M18.5 19a4 4 0 0 0-2.7-3.8" />
    </IconFrame>
  );
}

export function ConversationsIcon() {
  return (
    <IconFrame>
      <path d="M5 6.5a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H10l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z" />
    </IconFrame>
  );
}

export function UsageIcon() {
  return (
    <IconFrame>
      <path d="M4 19.5h16" />
      <path d="M7 16.5v-5" />
      <path d="M12 16.5V7.5" />
      <path d="M17 16.5v-8" />
    </IconFrame>
  );
}

export function CapturesIcon() {
  return (
    <IconFrame>
      <path d="M7 4.5h10a2 2 0 0 1 2 2v13l-3.5-2.2L12 19.5l-3.5-2.2L5 19.5v-13a2 2 0 0 1 2-2z" />
      <path d="M9 9h6" />
      <path d="M9 12.5h6" />
    </IconFrame>
  );
}

export function NotificationsIcon() {
  return (
    <IconFrame>
      <path d="M6 8.5a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 19.5a1.8 1.8 0 0 0 3.4 0" />
    </IconFrame>
  );
}

export function BuildingIcon() {
  return (
    <IconFrame>
      <path d="M6 20.5V5.5A1.5 1.5 0 0 1 7.5 4h9A1.5 1.5 0 0 1 18 5.5v15" />
      <path d="M3 20.5h18" />
      <path d="M9 8h.01" />
      <path d="M15 8h.01" />
      <path d="M9 12h.01" />
      <path d="M15 12h.01" />
    </IconFrame>
  );
}

export function ShieldIcon() {
  return (
    <IconFrame>
      <path d="M12 4 6 6.5V11c0 4.1 2.6 7.7 6 9 3.4-1.3 6-4.9 6-9V6.5z" />
      <path d="m9.5 11.5 1.7 1.7 3.3-3.7" />
    </IconFrame>
  );
}

export function ClockIcon() {
  return (
    <IconFrame>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </IconFrame>
  );
}

export function MenuIcon() {
  return (
    <IconFrame>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </IconFrame>
  );
}

export function ArrowLeftIcon() {
  return (
    <IconFrame>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </IconFrame>
  );
}

export function ChevronLeftIcon() {
  return (
    <IconFrame>
      <path d="m15 6-6 6 6 6" />
    </IconFrame>
  );
}

export function ChevronDownIcon() {
  return (
    <IconFrame>
      <path d="m6 9 6 6 6-6" />
    </IconFrame>
  );
}

export function UserIcon() {
  return (
    <IconFrame>
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </IconFrame>
  );
}

export function EditIcon() {
  return (
    <IconFrame>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </IconFrame>
  );
}

export function PauseIcon() {
  return (
    <IconFrame>
      <rect height="12" rx="1" width="4" x="6" y="6" />
      <rect height="12" rx="1" width="4" x="14" y="6" />
    </IconFrame>
  );
}

export function PlayIcon() {
  return (
    <IconFrame>
      <polygon points="6,4 20,12 6,20" />
    </IconFrame>
  );
}

export function EyeIcon() {
  return (
    <IconFrame>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </IconFrame>
  );
}
