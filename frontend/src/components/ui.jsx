import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, Loader2 } from 'lucide-react';

export function Logo({ size = 28, dark = false }) {
  return (
    <span className="logo" aria-label="Shortly">
      <span className="logo-mark" style={{ width: size, height: size }}>
        <Link2 size={size * 0.58} strokeWidth={2.4} />
      </span>
      <span className={`logo-word ${dark ? 'on-dark' : ''}`}>
        Short<span>ly</span>
      </span>
    </span>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <span className="spinner-wrap" role="status" aria-label={label}>
      <Loader2 size={18} className="spin" />
      <span>{label}…</span>
    </span>
  );
}

export function CopyButton({ value, label = 'Copy', className = 'btn btn-ghost btn-sm', onCopied }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for browsers without the async clipboard API.
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(true);
    onCopied?.(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button type="button" onClick={copy} className={className} aria-live="polite">
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

export function StatusPill({ status }) {
  return <span className={`status-pill is-${status}`}>{status}</span>;
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty-state">
      {Icon ? <span className="empty-icon"><Icon size={22} /></span> : null}
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function FieldError({ children }) {
  if (!children) return null;
  return <p className="field-error" role="alert">{children}</p>;
}

export function Banner({ tone = 'error', children }) {
  if (!children) return null;
  return <div className={`banner banner-${tone}`} role="status">{children}</div>;
}
