import { useNavigate } from 'react-router-dom';
import { Sheet } from './Sheet';
import { useAuth } from '../lib/auth/AuthContext';

export interface AppDrawerProps {
  open: boolean;
  onClose: () => void;
}

interface DrawerLink {
  label: string;
  to: string;
  icon: string;
}

const LINKS: DrawerLink[] = [
  { label: 'Home', to: '/', icon: '🏠' },
  { label: 'RIK — Ration in Kind', to: '/rik', icon: '📦' },
  { label: 'PIF — Payment Issue Facility', to: '/pif', icon: '🛒' },
  { label: 'My account', to: '/account', icon: '👤' },
  { label: 'Notifications', to: '/account/notifications', icon: '🔔' },
];

/** Hamburger-menu drawer (STEP 8 Section 8 — simple mobile navigation, kept separate from the bottom nav's 4 primary items). */
export function AppDrawer({ open, onClose }: AppDrawerProps) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <Sheet open={open} onClose={onClose} title="Menu">
      <nav className="flex flex-col divide-y divide-slate-100">
        {LINKS.map((link) => (
          <button
            key={link.to}
            type="button"
            onClick={() => {
              onClose();
              navigate(link.to);
            }}
            className="flex items-center gap-3 py-3.5 text-left text-sm font-medium text-slate-800"
          >
            <span aria-hidden="true" className="text-lg">
              {link.icon}
            </span>
            {link.label}
          </button>
        ))}
        <button
          type="button"
          onClick={async () => {
            onClose();
            await logout();
            navigate('/auth/login', { replace: true });
          }}
          className="flex items-center gap-3 py-3.5 text-left text-sm font-medium text-semantic-danger"
        >
          <span aria-hidden="true" className="text-lg">
            🚪
          </span>
          Log out
        </button>
      </nav>
    </Sheet>
  );
}
