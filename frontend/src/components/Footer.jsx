import { Link } from 'react-router-dom';
import { Github, Globe2, Heart } from 'lucide-react';
import { Logo } from './ui.jsx';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Logo dark />
          <p>
            Short links backed by Fastify, Redis, and PostgreSQL. Built to stay
            fast when traffic spikes.
          </p>
          <div className="footer-status">
            <span className="pulse-dot" />
            All systems operational
          </div>
        </div>

        <div className="footer-col">
          <h4>Product</h4>
          <Link to="/">Shorten a link</Link>
          <Link to="/login">Sign in</Link>
          <Link to="/register">Create account</Link>
        </div>

        <div className="footer-col">
          <h4>Developers</h4>
          <a href="/api/public/stats" target="_blank" rel="noreferrer">Public stats API</a>
          <a href="/health" target="_blank" rel="noreferrer">Service health</a>
          <Link to="/dashboard">Dashboard</Link>
        </div>

        <div className="footer-col">
          <h4>Platform</h4>
          <span className="footer-muted"><Globe2 size={14} /> Cloudflare-ready</span>
          <span className="footer-muted"><Github size={14} /> Self-hostable</span>
          <span className="footer-muted">v2.0</span>
        </div>
      </div>

      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} Shortly. All rights reserved.</span>
        <span className="footer-made">
          Engineered with <Heart size={13} /> for the open web
        </span>
      </div>
    </footer>
  );
}
