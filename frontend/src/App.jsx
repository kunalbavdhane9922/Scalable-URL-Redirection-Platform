import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar.jsx';
import UrlForm from './components/UrlForm.jsx';
import LinkList from './components/LinkList.jsx';
import LinkDetailsModal from './components/LinkDetailsModal.jsx';
import SystemHealth from './components/SystemHealth.jsx';
import { fetchHealth, fetchLinks } from './api/client.js';
import './App.css';

export default function App() {
  const [health, setHealth] = useState(null);
  const [showHealth, setShowHealth] = useState(false);
  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [selectedCode, setSelectedCode] = useState(null);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetchHealth();
      setHealth(res.data);
    } catch {
      setHealth({ status: 'unreachable', checks: { database: 'unreachable', redis: 'unreachable' } });
    }
  }, []);

  const loadLinks = useCallback(async () => {
    setLinksLoading(true);
    try {
      const data = await fetchLinks(50);
      setLinks(Array.isArray(data) ? data : data.links || []);
    } catch {
      // Backend links route might be empty initially
      setLinks([]);
    } finally {
      setLinksLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
    loadLinks();
    const healthInterval = setInterval(loadHealth, 15000);
    return () => clearInterval(healthInterval);
  }, [loadHealth, loadLinks]);

  const handleUrlCreated = (newMapping) => {
    loadLinks();
  };

  return (
    <div className="app-container">
      <Navbar
        health={health}
        showHealth={showHealth}
        onToggleHealth={() => setShowHealth(!showHealth)}
      />

      <main className="main-content">
        {showHealth && (
          <SystemHealth
            health={health}
            onRefreshHealth={loadHealth}
          />
        )}

        <UrlForm onUrlCreated={handleUrlCreated} />

        <LinkList
          links={links}
          loading={linksLoading}
          onRefresh={loadLinks}
          onSelectLink={(code) => setSelectedCode(code)}
        />
      </main>

      {selectedCode && (
        <LinkDetailsModal
          code={selectedCode}
          onClose={() => setSelectedCode(null)}
          onLinkUpdated={loadLinks}
        />
      )}
    </div>
  );
}
