import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import {
  devSignInUrl,
  fetchProviders,
  loginAccount,
  oauthSignInUrl,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
} from '../api/client.js';
import { useSession } from '../hooks/useSession.jsx';
import { Logo, Banner, FieldError } from '../components/ui.jsx';

const OAUTH_ERRORS = {
  access_denied: 'Sign-in was cancelled before it finished.',
  invalid_state: 'That sign-in attempt expired. Please try again.',
  missing_code: 'The provider did not return an authorization code.',
  oauth_failed: 'We could not complete sign-in with that provider. Please try again.',
  session_expired: 'Your session expired. Sign in again to continue.',
};

const ASIDE_COPY = {
  login: {
    title: 'Welcome back.',
    body: 'Every link you created while signed in is waiting — destinations, expiry dates, and click totals included.',
  },
  register: {
    title: 'One account. Every link.',
    body: 'Create an account and each short link you make is saved to your history, ready to edit or retire from any device.',
  },
  forgot: {
    title: 'Locked out?',
    body: 'We will email you a single-use link to set a new password. Your links and analytics stay untouched.',
  },
  reset: {
    title: 'Fresh start.',
    body: 'Pick a strong password. Setting a new one signs out every other active session for your account.',
  },
  verify: {
    title: 'Almost there.',
    body: 'Verifying your email keeps your account recoverable and proves the address is really yours.',
  },
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.09A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.27a12 12 0 0 0 0 10.76l4-3.09z" />
      <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.09C6.22 6.87 8.87 4.76 12 4.76z" />
    </svg>
  );
}

function PasswordField({ value, onChange, autoComplete = 'current-password', label = 'Password', placeholder = 'Your password', error }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className={`field-input password-input ${error ? 'has-error' : ''}`}>
        <KeyRound size={15} className="field-icon" />
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={10}
          maxLength={200}
          required
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      <FieldError>{error}</FieldError>
    </label>
  );
}

function OAuthSection({ providers }) {
  const list = providers?.providers || [];
  if (list.length === 0) return null;

  return (
    <div className="oauth-section">
      <div className="auth-divider"><span>or continue with</span></div>
      <div className="oauth-row">
        {list.includes('google') ? (
          <a className="oauth-btn" href={oauthSignInUrl('google')}>
            <GoogleIcon />
            Google
          </a>
        ) : null}
        {list.includes('github') ? (
          <a className="oauth-btn" href={oauthSignInUrl('github')}>
            <Github size={17} />
            GitHub
          </a>
        ) : null}
      </div>
    </div>
  );
}

function DevSignIn({ providers }) {
  if (!providers?.devLogin) return null;
  return (
    <div className="dev-login">
      <a className="btn btn-ghost btn-block btn-sm" href={devSignInUrl()}>
        Continue with dev sign-in
      </a>
      <p className="auth-note">Local development only — disabled in production.</p>
    </div>
  );
}

function LoginPanel({ providers, next, oauthError }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await loginAccount({ email: email.trim(), password });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Banner tone="error">{oauthError}</Banner>
      <OAuthSection providers={providers} />
      <form className="auth-form" onSubmit={submit} noValidate>
        {providers?.providers?.length ? <div className="auth-divider"><span>or use email</span></div> : null}
        <label className="field">
          <span className="field-label">Email</span>
          <div className="field-input">
            <Mail size={15} className="field-icon" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              maxLength={254}
              required
              autoFocus
            />
          </div>
        </label>
        <PasswordField value={password} onChange={setPassword} />
        <div className="auth-row-end">
          <Link to="/forgot-password" className="auth-inline-link">Forgot password?</Link>
        </div>
        <Banner tone="error">{error}</Banner>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <><Loader2 size={16} className="spin" /> Signing in…</> : <>Sign in <ArrowRight size={16} /></>}
        </button>
      </form>
      <DevSignIn providers={providers} />
    </>
  );
}

function RegisterPanel({ providers, next, oauthError }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setFieldError('');

    if (password.length < 10) {
      setFieldError('Use at least 10 characters.');
      return;
    }
    if (password !== confirm) {
      setFieldError('Those passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const result = await registerAccount({ name: name.trim() || undefined, email: email.trim(), password });
      if (result?.requiresVerification) {
        setPendingEmail(email.trim());
        return;
      }
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  };

  if (pendingEmail) {
    return (
      <div className="auth-success">
        <span className="auth-success-icon"><Mail size={22} /></span>
        <h3>Verify your email</h3>
        <p>
          We sent a confirmation link to <strong>{pendingEmail}</strong>. Open it
          before signing in.
        </p>
        <Link to="/login" className="btn btn-primary btn-block">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <Banner tone="error">{oauthError}</Banner>
      <OAuthSection providers={providers} />
      <form className="auth-form" onSubmit={submit} noValidate>
        {providers?.providers?.length ? <div className="auth-divider"><span>or sign up with email</span></div> : null}
        <label className="field">
          <span className="field-label">Name <span className="field-optional">optional</span></span>
          <div className="field-input">
            <UserIcon size={15} className="field-icon" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Ada Lovelace"
              maxLength={80}
            />
          </div>
        </label>
        <label className="field">
          <span className="field-label">Email</span>
          <div className="field-input">
            <Mail size={15} className="field-icon" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              maxLength={254}
              required
              autoFocus
            />
          </div>
        </label>
        <PasswordField
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          label="Password"
          placeholder="At least 10 characters"
          error={fieldError}
        />
        <PasswordField
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          label="Confirm password"
          placeholder="Repeat your password"
        />
        <Banner tone="error">{error}</Banner>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <><Loader2 size={16} className="spin" /> Creating account…</> : <>Create account <ArrowRight size={16} /></>}
        </button>
        <p className="auth-note">
          By creating an account you agree to keep your links reasonable and your
          password secret. We only store what is needed to run your dashboard.
        </p>
      </form>
      <DevSignIn providers={providers} />
    </>
  );
}

function ForgotPanel({ oauthError }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message || 'Could not request a reset link.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="auth-success">
        <span className="auth-success-icon"><Mail size={22} /></span>
        <h3>Check your inbox</h3>
        <p>
          If an account exists for <strong>{email}</strong>, a single-use reset
          link is on its way. It expires in 30 minutes.
        </p>
        {import.meta.env.DEV ? (
          <p className="auth-note">Local development: the link is printed in the API logs.</p>
        ) : null}
        <Link to="/login" className="btn btn-primary btn-block">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <Banner tone="error">{oauthError}</Banner>
      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="field">
          <span className="field-label">Email</span>
          <div className="field-input">
            <Mail size={15} className="field-icon" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              maxLength={254}
              required
              autoFocus
            />
          </div>
        </label>
        <Banner tone="error">{error}</Banner>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <><Loader2 size={16} className="spin" /> Sending…</> : <>Send reset link <ArrowRight size={16} /></>}
        </button>
      </form>
      <p className="auth-switch">
        Remembered it? <Link to="/login">Sign in</Link>
      </p>
    </>
  );
}

function ResetPanel({ oauthError }) {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setFieldError('');
    if (password.length < 10) {
      setFieldError('Use at least 10 characters.');
      return;
    }
    if (password !== confirm) {
      setFieldError('Those passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      setError(err.message || 'That reset link is invalid or has expired.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-success is-error">
        <span className="auth-success-icon"><ShieldCheck size={22} /></span>
        <h3>This link is incomplete</h3>
        <p>The reset token is missing. Request a fresh link and try again.</p>
        <Link to="/forgot-password" className="btn btn-primary btn-block">Request a new link</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-success">
        <span className="auth-success-icon"><CheckCircle2 size={22} /></span>
        <h3>Password updated</h3>
        <p>Every other session has been signed out. Use your new password to continue.</p>
        <Link to="/login" className="btn btn-primary btn-block">Sign in</Link>
      </div>
    );
  }

  return (
    <>
      <Banner tone="error">{oauthError}</Banner>
      <form className="auth-form" onSubmit={submit} noValidate>
        <PasswordField
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          label="New password"
          placeholder="At least 10 characters"
          error={fieldError}
        />
        <PasswordField
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          label="Confirm new password"
          placeholder="Repeat your password"
        />
        <Banner tone="error">{error}</Banner>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <><Loader2 size={16} className="spin" /> Updating…</> : <>Update password <ArrowRight size={16} /></>}
        </button>
      </form>
      <p className="auth-switch">
        <Link to="/login">Back to sign in</Link>
      </p>
    </>
  );
}

function VerifyPanel({ oauthError }) {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const { user, refresh } = useSession();
  const [status, setStatus] = useState(token ? 'working' : 'missing');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    verifyEmailToken(token)
      .then(() => {
        if (cancelled) return;
        setStatus('done');
        refresh();
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(err.message || 'This verification link is invalid or has expired.');
      });
    return () => { cancelled = true; };
  }, [token, refresh]);

  if (status === 'working') {
    return (
      <div className="auth-success">
        <span className="auth-success-icon"><Loader2 size={22} className="spin" /></span>
        <h3>Verifying your email…</h3>
        <p>One moment while we confirm your address.</p>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className="auth-success">
        <span className="auth-success-icon"><CheckCircle2 size={22} /></span>
        <h3>Email verified</h3>
        <p>Your account is confirmed. Everything is ready to go.</p>
        <Link to={user ? '/dashboard' : '/login'} className="btn btn-primary btn-block">
          {user ? 'Open dashboard' : 'Sign in'}
        </Link>
      </div>
    );
  }

  return (
    <div className="auth-success is-error">
      <span className="auth-success-icon"><ShieldCheck size={22} /></span>
      <h3>{status === 'missing' ? 'Verification link missing' : 'Could not verify'}</h3>
      <p>{status === 'missing' ? 'Open the link from your email to verify this address.' : message}</p>
      <Banner tone="error">{oauthError}</Banner>
      <Link to={user ? '/dashboard' : '/login'} className="btn btn-primary btn-block">
        {user ? 'Back to dashboard' : 'Back to sign in'}
      </Link>
      {user && !user.emailVerified ? (
        <p className="auth-note">You can request a new verification email from your dashboard.</p>
      ) : null}
    </div>
  );
}

const TITLES = {
  login: { title: 'Sign in', subtitle: 'Access your links, history, and analytics.' },
  register: { title: 'Create your account', subtitle: 'Save every link you shorten, on every device.' },
  forgot: { title: 'Reset your password', subtitle: 'We will email you a secure, single-use link.' },
  reset: { title: 'Choose a new password', subtitle: 'Make it memorable and at least 10 characters.' },
  verify: { title: 'Email verification', subtitle: 'Confirm your address to finish setting up.' },
};

const SWITCHES = {
  login: <>New here? <Link to="/register">Create an account</Link></>,
  register: <>Already have an account? <Link to="/login">Sign in</Link></>,
};

export default function AuthPage({ mode = 'login' }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useSession();
  const [providers, setProviders] = useState(null);

  const next = useMemo(() => {
    const raw = searchParams.get('next') || '/dashboard';
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
  }, [searchParams]);

  const oauthError = OAUTH_ERRORS[searchParams.get('error')] || '';

  useEffect(() => {
    if (mode !== 'login' && mode !== 'register') return undefined;
    let cancelled = false;
    fetchProviders()
      .then((data) => { if (!cancelled) setProviders(data); })
      .catch(() => { if (!cancelled) setProviders({ providers: [], devLogin: false }); });
    return () => { cancelled = true; };
  }, [mode]);

  useEffect(() => {
    if (!loading && user && (mode === 'login' || mode === 'register')) {
      navigate(next, { replace: true });
    }
  }, [loading, user, mode, next, navigate]);

  const { title, subtitle } = TITLES[mode] || TITLES.login;
  const aside = ASIDE_COPY[mode] || ASIDE_COPY.login;

  let panel = null;
  if (mode === 'register') panel = <RegisterPanel providers={providers} next={next} oauthError={oauthError} />;
  else if (mode === 'forgot') panel = <ForgotPanel oauthError={oauthError} />;
  else if (mode === 'reset') panel = <ResetPanel oauthError={oauthError} />;
  else if (mode === 'verify') panel = <VerifyPanel oauthError={oauthError} />;
  else panel = <LoginPanel providers={providers} next={next} oauthError={oauthError} />;

  return (
    <div className="auth-page">
      <Link to="/" className="auth-brand"><Logo /></Link>

      <div className="auth-card">
        <aside className="auth-aside">
          <span className="auth-badge"><Sparkles size={14} /> Links, kept together</span>
          <h1>{aside.title}</h1>
          <p>{aside.body}</p>
          <ul className="auth-points">
            <li><CheckCircle2 size={16} /> Every link made while signed in becomes part of your history.</li>
            <li><CheckCircle2 size={16} /> Retarget, expire, or disable links from any device.</li>
            <li><CheckCircle2 size={16} /> Google, GitHub, or email — whichever you prefer.</li>
          </ul>
          <Link to="/" className="auth-back"><ArrowLeft size={14} /> Back to the shortener</Link>
        </aside>

        <main className="auth-panel">
          <div className="auth-panel-head">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>

          {loading && (mode === 'login' || mode === 'register') ? (
            <div className="auth-loading"><Loader2 size={20} className="spin" /> Checking your session…</div>
          ) : (
            <>
              {panel}
              {SWITCHES[mode] ? <p className="auth-switch">{SWITCHES[mode]}</p> : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
