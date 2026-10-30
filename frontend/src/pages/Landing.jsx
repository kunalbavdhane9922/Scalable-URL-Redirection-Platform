import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Clock3,
  History,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import SiteHeader from '../components/SiteHeader.jsx';
import Footer from '../components/Footer.jsx';
import ShortenForm from '../components/ShortenForm.jsx';
import { fetchPublicStats } from '../api/client.js';
import { useSession } from '../hooks/useSession.jsx';

function compact(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

const VALUES = [
  {
    icon: History,
    title: 'Your history, saved',
    body: 'Sign in and every link you shorten is stored to your account — searchable, editable, and available on any device.',
  },
  {
    icon: Clock3,
    title: 'Expiry on your terms',
    body: 'Set a link to disappear after an hour, a week, or a custom date. Change or clear it any time from your dashboard.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by default',
    body: 'Links are yours alone. Other accounts cannot list, open, or change them — not even by guessing the code.',
  },
];

export default function Landing() {
  const [stats, setStats] = useState(null);
  const { user } = useSession();

  useEffect(() => {
    let cancelled = false;
    fetchPublicStats()
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setStats({ totalLinks: null, totalClicks: null, activeLinks: null }); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="landing">
      <SiteHeader />

      <main>
        <section className="hero hero-landing">
          <div className="hero-glow hero-glow-a" />
          <div className="hero-glow hero-glow-b" />
          <div className="hero-grid" aria-hidden="true" />

          <div className="container hero-inner">
            <span className="eyebrow">
              <Sparkles size={14} />
              Short links that remember you
            </span>

            <h1 className="hero-title">
              Shorten a link.
              <span className="hero-gradient"> Keep the history.</span>
            </h1>
            <p className="hero-sub">
              Paste any URL and get a short link instantly — no account needed.
              Sign in to keep every link, edit destinations, set expiry, and watch
              the clicks add up.
            </p>

            <div className="hero-form-card">
              <ShortenForm showManageLink />
              <div className="hero-form-footer">
                <span>Instant &amp; free</span>
                <span className="dot-sep" />
                <span>No account to create</span>
                <span className="dot-sep" />
                <span>Custom aliases</span>
                <span className="dot-sep" />
                <span>Expiring links</span>
              </div>
            </div>

            <div className="hero-stats">
              <div className="hero-stat">
                <strong>{stats ? compact(stats.totalLinks) : '—'}</strong>
                <span>Links created</span>
              </div>
              <div className="hero-stat">
                <strong>{stats ? compact(stats.totalClicks) : '—'}</strong>
                <span>Clicks redirected</span>
              </div>
              <div className="hero-stat">
                <strong>{stats ? compact(stats.activeLinks) : '—'}</strong>
                <span>Active right now</span>
              </div>
              <div className="hero-stat">
                <strong>&lt; 10ms</strong>
                <span>Warm redirect p50</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section landing-values">
          <div className="container">
            <div className="section-head">
              <span className="eyebrow eyebrow-light">Why sign in</span>
              <h2>Anonymous links work. Accounts keep them.</h2>
              <p>
                Shortening stays public. Create an account when you want your links
                stored, searchable, and under your control.
              </p>
            </div>

            <div className="value-grid">
              {VALUES.map(({ icon: Icon, title, body }) => (
                <article key={title} className="value-card">
                  <span className="value-icon"><Icon size={19} /></span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div className="container">
            <div className="cta-card">
              <div className="cta-glow" />
              <div>
                <span className="eyebrow">Ready when you are</span>
                <h2>{user ? 'Your dashboard is waiting.' : 'Keep your links in one place.'}</h2>
                <p>
                  {user
                    ? 'Jump back in to manage destinations, expiry dates, and click analytics.'
                    : 'Create a free account with Google, GitHub, or email. Your existing links stay exactly where they are.'}
                </p>
              </div>
              <div className="cta-actions">
                {user ? (
                  <Link to="/dashboard" className="btn btn-glow">
                    <UserRound size={16} />
                    Open dashboard
                  </Link>
                ) : (
                  <>
                    <Link to="/register" className="btn btn-glow">
                      Create account
                      <ArrowRight size={16} />
                    </Link>
                    <Link to="/login" className="btn btn-outline">Sign in</Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
