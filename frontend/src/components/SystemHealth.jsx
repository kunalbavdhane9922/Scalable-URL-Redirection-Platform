import React, { useState, useEffect } from 'react';
import { Database, HardDrive, Cpu, Layers, RefreshCw, CheckCircle2, AlertCircle, Shield, Radio } from 'lucide-react';
import { fetchHealth, fetchMetrics } from '../api/client.js';

export default function SystemHealth({ health, onRefreshHealth }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMetrics();
      setMetrics(data);
    } catch (err) {
      // In production behind NGINX, /health/metrics may be internal only
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, []);

  const dbStatus = health?.checks?.database || 'unknown';
  const redisStatus = health?.checks?.redis || 'unknown';

  return (
    <div className="card health-card">
      <div className="health-header">
        <div className="health-title-group">
          <Layers size={20} className="text-blue" />
          <div>
            <h3 className="section-title">Platform Architecture & Observability</h3>
            <p className="section-subtitle">Real-time status of two-level cache, database pool, and asynchronous pipeline</p>
          </div>
        </div>

        <button
          onClick={() => {
            onRefreshHealth();
            loadMetrics();
          }}
          className="btn-icon"
          title="Refresh health & metrics"
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'spinning' : ''} />
        </button>
      </div>

      {/* Layer Health Cards */}
      <div className="architecture-grid">
        {/* Layer 1: Local In-Memory LRU */}
        <div className="arch-card">
          <div className="arch-top">
            <Cpu size={18} className="text-cyan" />
            <span className="arch-name">L1 In-Memory LRU</span>
            <span className="status-badge status-active">0.1 - 1ms</span>
          </div>
          <p className="arch-desc">Instance-local bounded LRU avoiding network round-trips for hot keys.</p>
          <div className="arch-stats">
            <div className="arch-stat-row">
              <span>Positive Entries:</span>
              <span className="mono-val">{metrics?.cache?.l1?.positive?.size ?? 'Active'}</span>
            </div>
            <div className="arch-stat-row">
              <span>Negative Cache:</span>
              <span className="mono-val">{metrics?.cache?.l1?.negative?.size ?? 'Active'}</span>
            </div>
            <div className="arch-stat-row">
              <span>In-Flight Coalescing:</span>
              <span className="mono-val">{metrics?.cache?.inflightRequests ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Layer 2: Shared Redis L2 */}
        <div className="arch-card">
          <div className="arch-top">
            <HardDrive size={18} className="text-purple" />
            <span className="arch-name">L2 Shared Redis</span>
            <span className={`status-badge ${redisStatus === 'healthy' ? 'status-active' : 'status-expired'}`}>
              {redisStatus.toUpperCase()}
            </span>
          </div>
          <p className="arch-desc">Shared cache with TTL jitter, negative caching, and Pub/Sub invalidation broadcast.</p>
          <div className="arch-stats">
            <div className="arch-stat-row">
              <span>Status:</span>
              <span className="mono-val">{redisStatus}</span>
            </div>
            <div className="arch-stat-row">
              <span>Pub/Sub Invalidation:</span>
              <span className="mono-val">Active channel</span>
            </div>
            <div className="arch-stat-row">
              <span>Fallback Protection:</span>
              <span className="mono-val">Graceful DB fallback</span>
            </div>
          </div>
        </div>

        {/* Layer 3: Authoritative PostgreSQL */}
        <div className="arch-card">
          <div className="arch-top">
            <Database size={18} className="text-blue" />
            <span className="arch-name">PostgreSQL Source of Truth</span>
            <span className={`status-badge ${dbStatus === 'healthy' ? 'status-active' : 'status-disabled'}`}>
              {dbStatus.toUpperCase()}
            </span>
          </div>
          <p className="arch-desc">Durable mapping store with unique constraint collision resolution and transactional outbox.</p>
          <div className="arch-stats">
            <div className="arch-stat-row">
              <span>Connection Pool:</span>
              <span className="mono-val">{metrics?.pgPool?.totalCount ?? 'Connected'}</span>
            </div>
            <div className="arch-stat-row">
              <span>Idle Connections:</span>
              <span className="mono-val">{metrics?.pgPool?.idleCount ?? 'Pooled'}</span>
            </div>
            <div className="arch-stat-row">
              <span>Indexed Query:</span>
              <span className="mono-val">UNIQUE(short_code)</span>
            </div>
          </div>
        </div>

        {/* Layer 4: Async Pipeline */}
        <div className="arch-card">
          <div className="arch-top">
            <Radio size={18} className="text-emerald" />
            <span className="arch-name">Asynchronous Pipeline</span>
            <span className="status-badge status-active">Non-blocking</span>
          </div>
          <p className="arch-desc">Redis Streams event buffer & background workers for idempotent click aggregation and cleanup.</p>
          <div className="arch-stats">
            <div className="arch-stat-row">
              <span>Redirect Critical Path:</span>
              <span className="mono-val">&lt; 50ms (p95 target)</span>
            </div>
            <div className="arch-stat-row">
              <span>Click Event Capture:</span>
              <span className="mono-val">Fire-and-forget</span>
            </div>
            <div className="arch-stat-row">
              <span>Outbox Relay:</span>
              <span className="mono-val">5s periodic sync</span>
            </div>
          </div>
        </div>
      </div>

      {metrics?.process && (
        <div className="runtime-bar">
          <span className="runtime-item">
            <strong>Uptime:</strong> {Math.floor(metrics.process.uptime / 60)}m {Math.floor(metrics.process.uptime % 60)}s
          </span>
          <span className="runtime-item">
            <strong>Heap Memory:</strong> {Math.round(metrics.process.memoryUsage.heapUsed / 1024 / 1024)} MB
          </span>
          <span className="runtime-item">
            <strong>RSS:</strong> {Math.round(metrics.process.memoryUsage.rss / 1024 / 1024)} MB
          </span>
        </div>
      )}
    </div>
  );
}
