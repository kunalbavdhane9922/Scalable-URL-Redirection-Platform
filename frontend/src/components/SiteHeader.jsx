import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  LayoutDashboard,
  LogOut,
  Menu,
  UserRound,
  X,
} from 'lucide-react';
import { Logo } from './ui.jsx';
import { useSession } from '../hooks/useSession.jsx';

export function initials(user) {
  const source = (user?.name || user?.email || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 1).toUpperCase();
}

export function Avatar({ user, size = 30 }) {
  const style = { width: size, height: size };
  if (user?.avatarUrl) {
    return <img className="avatar" style={style} src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />;
  }
  return <span className="avatar avatar-initials" style={style} aria-hidden="true">{initials(user)}</span>;
}

function AccountMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account-wrap" ref={wrapRef}>
      <button
        type="button"
        className="account-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar user={user} />
        <span className="account-trigger-name">{user.name || user.email.split('@')[0]}</span>
      </button>

      {open ? (
        <div className="account-dropdown" role="menu">
          <div className="account-meta">
            <Avatar user={user} size={36} />
            <div>
              <strong>{user.name || 'Your account'}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <Link to="/dashboard" className="account-item" role="menuitem" onClick={() => setOpen(false)}>
            <LayoutDashboard size={15} />
            Dashboard
          </Link>
          <Link to="/dashboard#account" className="account-item" role="menuitem" onClick={() => setOpen(false)}>
            <UserRound size={15} />
            Account settings
          </Link>
          <button type="button" className="account-item is-danger" role="menuitem" onClick={onSignOut}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { user, loading, signOut } = useSession();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const close = () => setOpen(false);

  const signOutAndClose = async () => {
    close();
    await signOut();
  };

  return (
    <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="site-header-inner">
        <Link to="/" className="brand-link" onClick={close}>
          <Logo dark />
        </Link>

        <div className="site-header-actions">
          {loading ? (
            <span className="header-ghost" aria-hidden="true" />
          ) : user ? (
            <>
              <Link to="/dashboard" className="btn btn-glow btn-sm">
                <LayoutDashboard size={15} />
                Dashboard
              </Link>
              <AccountMenu user={user} onSignOut={signOut} />
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-text btn-sm">Sign in</Link>
              <Link to="/register" className="btn btn-glow btn-sm">
                Create account
                <ArrowUpRight size={15} />
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="mobile-menu-btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open ? (
        <div className="mobile-menu">
          {user ? (
            <>
              <div className="mobile-account">
                <Avatar user={user} size={34} />
                <div>
                  <strong>{user.name || 'Signed in'}</strong>
                  <span>{user.email}</span>
                </div>
              </div>
              <Link to="/dashboard" onClick={close} className="btn btn-glow">
                <LayoutDashboard size={16} />
                Dashboard
              </Link>
              <button type="button" onClick={signOutAndClose} className="mobile-menu-link mobile-signout">
                <LogOut size={16} />
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" onClick={close} className="btn btn-outline">
                Sign in
              </Link>
              <Link to="/register" onClick={close} className="btn btn-glow">
                Create account
                <ArrowUpRight size={16} />
              </Link>
            </>
          )}
        </div>
      ) : null}
    </header>
  );
}
