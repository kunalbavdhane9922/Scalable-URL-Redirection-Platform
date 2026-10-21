import React from 'react';
import { Link2, Activity, Server, ShieldCheck } from 'lucide-react';

export default function Navbar({ health, onToggleHealth, showHealth }) {
  const isHealthy = health?.status === 'healthy';

  return (
    <header className="navbar">
      <div className="navbar-container">
        <div className="navbar-brand">
          <div className="logo-icon">
            <Link2 size={24} className="text-blue" />
          </div>
          <div>
            <h1 className="brand-title">URL Redirection Platform</h1>
            <p className="brand-subtitle">High-Throughput Low-Latency Engine</p>
          </div>
        </div>

        <div className="navbar-actions">
          <div className={`health-badge ${isHealthy ? 'healthy' : 'degraded'}`}>
            <span className="pulse-dot"></span>
            <span className="health-text">
              {health ? (isHealthy ? 'System Healthy' : 'System Degraded') : 'Connecting...'}
            </span>
          </div>

          <button
            onClick={onToggleHealth}
            className={`btn-secondary ${showHealth ? 'active' : ''}`}
            title="Inspect System Architecture & Observability"
          >
            <Activity size={18} />
            <span>Architecture & Health</span>
          </button>
        </div>
      </div>
    </header>
  );
}
