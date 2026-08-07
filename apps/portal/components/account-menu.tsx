'use client';

import { useEffect, useRef, useState } from 'react';

import { logout } from '../app/dashboard/actions';
import { ChevronDownIcon } from './icons';

type AccountMenuProps = {
  email: string | null;
  membershipRole: string | null;
  tenantName: string | null;
};

function buildInitials(email: string | null, tenantName: string | null) {
  const tenantParts = tenantName
    ?.split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (tenantParts && tenantParts.length > 0) {
    return tenantParts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  const emailName = email?.split('@')[0]?.trim();

  if (emailName) {
    return emailName.slice(0, 2).toUpperCase();
  }

  return 'SR';
}

export function AccountMenu({
  email,
  membershipRole,
  tenantName,
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const initials = buildInitials(email, tenantName);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div className="account-menu" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="account-menu-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <span aria-hidden="true" className="account-menu-avatar">
          {initials}
        </span>
        <span className="account-menu-chevron">
          <ChevronDownIcon />
        </span>
      </button>

      {isOpen ? (
        <div className="account-menu-panel" role="menu">
          <div className="account-menu-label">Account</div>
          <div className="account-menu-item">
            <span className="account-menu-key">Tenant</span>
            <span className="account-menu-value">
              {tenantName ?? 'No tenant assigned'}
            </span>
          </div>
          <div className="account-menu-item">
            <span className="account-menu-key">Email</span>
            <span className="account-menu-value">
              {email ?? 'No active session'}
            </span>
          </div>
          <div className="account-menu-item">
            <span className="account-menu-key">Role</span>
            <span className="account-menu-value">
              {membershipRole ?? 'No membership'}
            </span>
          </div>
          <form action={logout}>
            <button className="button account-menu-button" type="submit">
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
