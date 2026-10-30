import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  ExternalLink,
  Gauge,
  History,
  LayoutDashboard,
  Link2,
  LogOut,
  MailCheck,
  Menu,
  MousePointerClick,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import {
  fetchLinks,
  fetchPlatformStats,
  resendVerification,
} from '../api/client.js';
import { useSession, useDebouncedValue } from '../hooks/useSession.jsx';
import { compactNumber, formatDate } from '../lib/format.js';
import { Avatar } from '../components/SiteHeader.jsx';
import LinkTable, { TopLinks } from '../components/LinkTable.jsx';
import LinkDetailsModal from '../components/LinkDetailsModal.jsx';
import ShortenForm from '../components/ShortenForm.jsx';
import ClicksChart from '../components/ClicksChart.jsx';
import { Logo, Spinner, Banner } from '../components/ui.jsx';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'links', label: 'My links', icon: Link2 },
  { id: 'account', label: 'Account', icon: UserRound },
];

function StatCard({ icon: Icon, label, value, hint, tone = 'indigo' }) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <span className="stat-icon"><Icon size={18} /></span>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </div>
    </article>
  );
}

export default function Dashboard() {
  const { user, loading: sessionLoading, signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [links, setLinks] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksError, setLinksError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [selectedCode, setSelectedCode] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState('');
  const [verificationNote, setVerificationNote] = useState('');
  const [resending, setResending] = useState(false);
  const signingOutRef = useRef(false);

  const limit = view === 'overview' ? 6 : 10;

  const goToLogin = useCallback(() => {
    navigate(`/login?next=${encodeURIComponent('/dashboard')}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!sessionLoading && !user && !signingOutRef.current) goToLogin();
  }, [sessionLoading, user, goToLogin]);

  useEffect(() => {
    if (location.hash === '#account') setView('account');
  }, [location.hash]);

  const loadStats = useCallback(async () => {
    setStatsError('');
    try {
      const data = await fetchPlatformStats();
      setStats(data);
    } catch (err) {
      if (err.status === 401 || err.status === 403) goToLogin();
      else setStatsError(err.message || 'Could not load your statistics.');
    } finally {
      setStatsLoading(false);
    }
  }, [goToLogin]);

  const loadLinks = useCallback(async () => {
    setLinksError('');
    try {
      const data = await fetchLinks({
        page: view === 'overview' ? 1 : page,
        limit,
        q: view === 'links' ? debouncedSearch : '',
        status: view === 'links' ? status : '',
      });
      setLinks(data.items || []);
      setPagination(data.pagination || { page: 1, limit, total: 0, totalPages: 1 });
    } catch (err) {
      if (err.status === 401 || err.status === 403) goToLogin();
      else setLinksError(err.message || 'Could not load your links.');
    } finally {
      setLinksLoading(false);
    }
  }, [view, page, limit, debouncedSearch, status, goToLogin]);

  useEffect(() => {
    if (!user) return;
    loadStats();
  }, [user, loadStats]);

  useEffect(() => {
    if (!user || view === 'account') return;
    setLinksLoading(true);
    loadLinks();
  }, [user, view, loadLinks]);

  useEffect(() => {
    const code = searchParams.get('link');
    if (code) {
      setSelectedCode(code);
      setView((current) => (current === 'account' ? 'links' : current));
    }
  }, [searchParams]);

  useEffect(() => {
    if (!searchParams.get('welcome')) return;
    setToast('Signed in — every link you shorten now lands in your history.');
    const next = new URLSearchParams(searchParams);
    next.delete('welcome');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (view === 'links') setPage(1);
  }, [debouncedSearch, status, view]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  const openDetails = (link) => {
    setSelectedCode(link.shortCode);
    const next = new URLSearchParams(searchParams);
    next.set('link', link.shortCode);
    setSearchParams(next, { replace: true });
  };

  const closeDetails = () => {
    setSelectedCode(null);
    const next = new URLSearchParams(searchParams);
    next.delete('link');
    setSearchParams(next, { replace: true });
  };

  const refreshAll = () => {
    loadStats();
    loadLinks();
  };

  const handleSignOut = async () => {
    signingOutRef.current = true;
    await signOut();
    navigate('/', { replace: true });
  };

  const resend = async () => {
    setResending(true);
    setVerificationNote('');
    try {
      const result = await resendVerification();
      setVerificationNote(
        result?.verificationSent
          ? 'Verification email sent — check your inbox.'
          : 'Email delivery is not configured on this server. Check the API logs.',
      );
    } catch (err) {
      setVerificationNote(err.message || 'Could not send the verification email.');
    } finally {
      setResending(false);
    }
  };

  const statsCards = useMemo(() => {
    if (!stats) return [];
    const totalLinks = stats.totalLinks || 0;
    const totalClicks = stats.totalClicks || 0;
    const average = totalLinks > 0 ? Math.round(totalClicks / totalLinks) : 0;
    return [
      {
        icon: Link2,
        label: 'Your links',
        value: compactNumber(totalLinks),
        hint: `${(stats.linksLast24h || 0).toLocaleString()} created in 24h`,
        tone: 'indigo',
      },
      {
        icon: Zap,
        label: 'Active links',
        value: compactNumber(stats.activeLinks),
        hint: `${(stats.disabledLinks || 0).toLocaleString()} disabled · ${(stats.expiredLinks || 0).toLocaleString()} expired`,
        tone: 'emerald',
      },
      {
        icon: MousePointerClick,
        label: 'Total clicks',
        value: compactNumber(totalClicks),
        hint: 'Aggregated by background workers',
        tone: 'cyan',
      },
      {
        icon: Gauge,
        label: 'Avg. clicks per link',
        value: compactNumber(average),
        hint: 'Across everything you own',
        tone: 'violet',
      },
    ];
  }, [stats]);

  if (sessionLoading) {
    return (
      <div className="dash-loading">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (!user) return null;

  const go = (id) => {
    setView(id);
    setMobileNav(false);
    navigate(id === 'account' ? '/dashboard#account' : '/dashboard', { replace: true });
  };

  const viewTitle =
    view === 'overview' ? 'Overview' : view === 'links' ? 'My links' : 'Account';
  const viewSubtitle =
    view === 'overview'
      ? 'Traffic, links, and click health at a glance.'
      : view === 'links'
        ? 'Search, inspect, retarget, and set expiry on your links.'
        : 'Your profile, verification status, and session.';

  return (
    <div className="dashboard">
      <aside className={`dash-sidebar ${mobileNav ? 'is-open' : ''}`}>
        <div className="dash-brand">
          <Link to="/" onClick={() => setMobileNav(false)}><Logo dark /></Link>
          <button type="button" className="icon-button dash-close" onClick={() => setMobileNav(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="dash-nav" aria-label="Dashboard">
          <span className="dash-nav-label">Workspace</span>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`dash-nav-item ${view === id ? 'is-active' : ''}`}
              onClick={() => go(id)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}

          <span className="dash-nav-label">Shortcuts</span>
          <Link to="/" className="dash-nav-item">
            <ExternalLink size={17} />
            Public site
          </Link>
          <a href="/health" target="_blank" rel="noreferrer" className="dash-nav-item">
            <ShieldCheck size={17} />
            Service health
          </a>
        </nav>

        <div className="dash-sidebar-foot">
          <div className="account-card">
            <Avatar user={user} size={34} />
            <div>
              <strong>{user.name || 'Signed in'}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <button type="button" className="dash-disconnect" onClick={handleSignOut}>
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      {mobileNav ? <div className="dash-scrim" onClick={() => setMobileNav(false)} /> : null}

      <div className="dash-main">
        <header className="dash-topbar">
          <div className="dash-topbar-left">
            <button type="button" className="icon-button dash-menu" onClick={() => setMobileNav(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <div>
              <h1>{viewTitle}</h1>
              <p className="muted">{viewSubtitle}</p>
            </div>
          </div>

          <div className="dash-topbar-actions">
            {view !== 'account' ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={refreshAll}
                aria-label="Refresh data"
              >
                <RefreshCw size={15} />
                <span className="hide-sm">Refresh</span>
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setShowCreate((v) => !v);
                if (view !== 'links') go('links');
              }}
            >
              <Plus size={16} />
              New link
            </button>
            <button
              type="button"
              className="avatar-button"
              onClick={() => go('account')}
              aria-label="Account settings"
            >
              <Avatar user={user} />
            </button>
          </div>
        </header>

        <div className="dash-content">
          <Banner tone="error">{statsError || linksError}</Banner>

          {user && !user.emailVerified ? (
            <section className="verify-banner">
              <span className="verify-icon"><MailCheck size={19} /></span>
              <div>
                <strong>Verify your email</strong>
                <p>
                  We sent a link to {user.email}. Verifying keeps your account
                  recoverable and confirms it is really you.
                </p>
                {verificationNote ? <p className="verify-note">{verificationNote}</p> : null}
              </div>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={resend}
                disabled={resending}
              >
                {resending ? 'Sending…' : 'Resend email'}
              </button>
            </section>
          ) : null}

          {showCreate ? (
            <section className="panel create-panel">
              <div className="panel-head">
                <div>
                  <h2>Create a short link</h2>
                  <p className="muted">Saved to your account as soon as it&apos;s created.</p>
                </div>
                <button type="button" className="icon-button" onClick={() => setShowCreate(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <ShortenForm
                compact
                onCreated={(created) => {
                  setToast(
                    created.owned
                      ? `Saved ${created.shortUrl} to your dashboard`
                      : `Created ${created.shortUrl}`,
                  );
                  setShowCreate(false);
                  setView('links');
                  setTimeout(refreshAll, 100);
                }}
              />
            </section>
          ) : null}

          {view === 'overview' ? (
            <>
              <section className="stat-grid">
                {statsLoading && !stats
                  ? [0, 1, 2, 3].map((i) => <div key={i} className="stat-card skeleton tall" />)
                  : statsCards.map((card) => <StatCard key={card.label} {...card} />)}
              </section>

              <div className="overview-grid">
                <section className="panel panel-chart">
                  {stats ? <ClicksChart rows={stats.clicksSeries} /> : <Spinner label="Loading chart" />}
                </section>

                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Top links</h2>
                      <p className="muted">By lifetime clicks.</p>
                    </div>
                    <MousePointerClick size={16} className="muted-icon" />
                  </div>
                  <TopLinks links={stats?.topLinks} />
                </section>
              </div>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Recent links</h2>
                    <p className="muted">Your six most recently created links.</p>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('links')}>
                    View all
                    <ArrowRight size={14} />
                  </button>
                </div>
                <LinkTable
                  items={links}
                  loading={linksLoading}
                  onSelect={openDetails}
                  emptyAction={
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                      <Plus size={15} />
                      Create a link
                    </button>
                  }
                />
              </section>
            </>
          ) : null}

          {view === 'links' ? (
            <section className="panel">
              <div className="links-toolbar">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    type="search"
                    placeholder="Search by code or destination…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search ? (
                    <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                      <X size={14} />
                    </button>
                  ) : null}
                </div>

                <div className="filter-group" role="group" aria-label="Filter by status">
                  {['', 'active', 'disabled', 'expired'].map((value) => (
                    <button
                      key={value || 'all'}
                      type="button"
                      className={`filter-chip ${status === value ? 'is-active' : ''}`}
                      onClick={() => setStatus(value)}
                    >
                      {value || 'All'}
                    </button>
                  ))}
                </div>

                <span className="links-count">
                  {pagination.total.toLocaleString()} link{pagination.total === 1 ? '' : 's'}
                </span>
              </div>

              <LinkTable
                items={links}
                loading={linksLoading}
                onSelect={openDetails}
                emptyAction={
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                    <Plus size={15} />
                    Create a link
                  </button>
                }
              />

              {pagination.totalPages > 1 ? (
                <div className="pagination">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={pagination.page <= 1 || linksLoading}
                  >
                    Previous
                  </button>
                  <span className="pagination-info">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                    disabled={pagination.page >= pagination.totalPages || linksLoading}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {view === 'account' ? (
            <div className="account-grid">
              <section className="panel account-panel" id="account">
                <div className="account-profile">
                  <Avatar user={user} size={58} />
                  <div className="account-profile-body">
                    <h2>{user.name || user.email.split('@')[0]}</h2>
                    <p>{user.email}</p>
                    <div className="account-badges">
                      <span className={`status-pill ${user.emailVerified ? 'is-active' : 'is-expired'}`}>
                        {user.emailVerified ? 'Verified' : 'Unverified'}
                      </span>
                      <span className="account-since">
                        <CalendarDays size={13} />
                        Member since {formatDate(user.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {!user.emailVerified ? (
                  <div className="account-verify">
                    <p>
                      Verify your email to secure account recovery. The link was
                      sent to <strong>{user.email}</strong>.
                    </p>
                    {verificationNote ? <p className="verify-note">{verificationNote}</p> : null}
                    <button type="button" className="btn btn-soft btn-sm" onClick={resend} disabled={resending}>
                      {resending ? 'Sending…' : 'Resend verification email'}
                    </button>
                  </div>
                ) : (
                  <div className="account-verify is-ok">
                    <ShieldCheck size={16} />
                    <p>Your email is verified and your account is fully set up.</p>
                  </div>
                )}

                <div className="account-actions">
                  <button type="button" className="btn btn-danger-ghost btn-sm" onClick={handleSignOut}>
                    <LogOut size={14} />
                    Sign out of this device
                  </button>
                </div>
              </section>

              <section className="panel account-tips">
                <div className="panel-head">
                  <div>
                    <h2>How links are stored</h2>
                    <p className="muted">What happens while you are signed in.</p>
                  </div>
                  <History size={16} className="muted-icon" />
                </div>
                <ul className="account-tip-list">
                  <li>
                    <span className="account-tip-icon"><Link2 size={15} /></span>
                    <div>
                      <strong>New links belong to you</strong>
                      <p>Anything shortened here is saved to this account and appears in your history.</p>
                    </div>
                  </li>
                  <li>
                    <span className="account-tip-icon"><Gauge size={15} /></span>
                    <div>
                      <strong>Only you can manage them</strong>
                      <p>Listing, editing, expiry changes, and disabling are scoped to your account.</p>
                    </div>
                  </li>
                  <li>
                    <span className="account-tip-icon"><UserRound size={15} /></span>
                    <div>
                      <strong>Anonymous links stay unowned</strong>
                      <p>Links created while signed out keep working, but they never appear in a history.</p>
                    </div>
                  </li>
                </ul>
              </section>
            </div>
          ) : null}
        </div>
      </div>

      {selectedCode ? (
        <LinkDetailsModal
          code={selectedCode}
          onClose={closeDetails}
          onChanged={() => {
            setToast('Link updated · caches refreshed');
            refreshAll();
          }}
        />
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          <span className="toast-dot" />
          {toast}
        </div>
      ) : null}
    </div>
  );
}
