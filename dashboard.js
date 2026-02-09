/**
 * OpenClaw Dashboard — Frontend
 * Uses safe DOM manipulation (no innerHTML with untrusted data).
 */

const API_BASE = window.location.origin + '/api';
const activities = [];
let refreshInterval = 10000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely set text content of an element by ID. */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Remove all children of an element. */
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Create an element with classes and optional text. */
function el(tag, classes = '', text = '') {
  const e = document.createElement(tag);
  if (classes) e.className = classes;
  if (text) e.textContent = text;
  return e;
}

/** Activity log — uses textContent, never innerHTML. */
function log(msg) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  activities.unshift(`[${time}] ${msg}`);
  if (activities.length > 50) activities.pop();

  const container = document.getElementById('activity');
  clearChildren(container);
  for (const entry of activities) {
    container.appendChild(el('div', '', entry));
  }
}

function updateTime() {
  setText(
    'current-time',
    new Date().toLocaleTimeString('en-US', { hour12: false }),
  );
  setText('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
}

async function fetchData(endpoint) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`);
    return await res.json();
  } catch (e) {
    console.error(`Failed to fetch ${endpoint}:`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Section renderers (safe DOM manipulation)
// ---------------------------------------------------------------------------

async function loadConfig() {
  const data = await fetchData('/config');
  if (!data) return;

  if (data.dashboardTitle) {
    setText('dashboard-title', data.dashboardTitle);
    document.title = data.dashboardTitle + ' \uD83E\uDD9E';
  }
  if (data.refreshInterval) {
    refreshInterval = data.refreshInterval;
  }
  if (data.quickLinks && data.quickLinks.length > 0) {
    const container = document.getElementById('quick-links');
    clearChildren(container);
    for (const link of data.quickLinks) {
      const a = el('a', 'bg-gray-800 hover:bg-gray-700 rounded-lg p-3 text-center transition');
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(el('div', 'text-2xl mb-1', link.icon || '\uD83D\uDD17'));
      a.appendChild(el('div', 'text-sm', link.name));
      container.appendChild(a);
    }
  }
}

async function updateSystem() {
  const data = await fetchData('/system');
  if (!data) return;

  setText('cpu', `${data.cpu}%`);
  const cpuBar = document.getElementById('cpu-bar');
  cpuBar.style.width = `${Math.min(data.cpu, 100)}%`;
  cpuBar.className = `h-2 rounded-full transition-all ${data.cpu > 80 ? 'bg-danger' : data.cpu > 60 ? 'bg-warning' : 'bg-accent'}`;

  setText('memory', `${data.memoryUsed} / ${data.memoryTotal}`);
  const memBar = document.getElementById('memory-bar');
  memBar.style.width = `${Math.min(data.memoryPct, 100)}%`;
  memBar.className = `h-2 rounded-full transition-all ${data.memoryPct > 80 ? 'bg-danger' : data.memoryPct > 60 ? 'bg-warning' : 'bg-accent'}`;

  setText('disk', `${data.diskUsed} / ${data.diskTotal}`);
  const diskBar = document.getElementById('disk-bar');
  diskBar.style.width = `${Math.min(data.diskPct, 100)}%`;
  diskBar.className = `h-2 rounded-full transition-all ${data.diskPct > 80 ? 'bg-danger' : data.diskPct > 60 ? 'bg-warning' : 'bg-accent'}`;

  setText('uptime', data.uptime);
  log('System status updated');
}

async function updateSessions() {
  const data = await fetchData('/sessions');
  if (!data || !data.sessions) return;

  const container = document.getElementById('sessions');
  clearChildren(container);

  if (data.sessions.length === 0) {
    container.appendChild(
      el('div', 'text-gray-500 text-center py-4', 'No active sessions'),
    );
  } else {
    for (const s of data.sessions) {
      const row = el('div', 'flex items-center justify-between bg-gray-800/50 rounded-lg p-2');
      const left = el('div', 'min-w-0 flex-1');
      left.appendChild(el('div', 'text-sm font-medium truncate', s.name));
      left.appendChild(el('div', 'text-xs text-gray-500', s.channel));
      row.appendChild(left);
      row.appendChild(
        el('div', 'text-xs text-gray-400 ml-2', `${(s.tokens / 1000).toFixed(1)}k`),
      );
      container.appendChild(row);
    }
  }
  log(`Loaded ${data.sessions.length} sessions`);
}

async function updateServices() {
  const data = await fetchData('/services');
  if (!data || !data.services) return;

  const container = document.getElementById('services');
  clearChildren(container);

  if (data.services.length === 0) {
    container.appendChild(
      el('div', 'text-gray-500 text-center py-4', 'No services configured'),
    );
  } else {
    for (const s of data.services) {
      const row = el('div', 'flex items-center justify-between');
      const left = el('div', 'flex items-center gap-2');
      const dot = el('div', `status-dot ${s.status === 'up' ? 'status-online' : 'status-offline'}`);
      left.appendChild(dot);
      left.appendChild(el('span', '', s.name));
      row.appendChild(left);
      row.appendChild(el('span', 'text-gray-500 text-sm', `:${s.port}`));
      container.appendChild(row);
    }
  }
}

async function updateNetwork() {
  const data = await fetchData('/network');
  if (!data || !data.hosts) return;

  const container = document.getElementById('network');
  clearChildren(container);

  if (data.hosts.length === 0) {
    container.appendChild(
      el('div', 'text-gray-500 text-center py-4', 'No hosts configured'),
    );
  } else {
    for (const h of data.hosts) {
      const row = el('div', 'flex items-center justify-between');
      const left = el('div', 'flex items-center gap-2');
      const dot = el('div', `status-dot ${h.status === 'online' ? 'status-online' : 'status-offline'}`);
      left.appendChild(dot);
      left.appendChild(el('span', '', h.name));
      row.appendChild(left);
      row.appendChild(el('span', 'text-gray-500 text-sm', h.ip));
      container.appendChild(row);
    }
  }
}

async function updateCrons() {
  const data = await fetchData('/crons');
  if (!data || !data.jobs) return;

  const container = document.getElementById('crons');
  clearChildren(container);

  if (data.jobs.length === 0) {
    container.appendChild(
      el('div', 'text-gray-500 text-center py-4', 'No cron jobs'),
    );
  } else {
    for (const j of data.jobs) {
      const row = el('div', 'flex items-center justify-between bg-gray-800/50 rounded-lg p-2');
      const left = el('div', '');
      left.appendChild(el('div', 'text-sm font-medium', j.name));
      left.appendChild(el('div', 'text-xs text-gray-500 font-mono', j.schedule));
      row.appendChild(left);
      row.appendChild(
        el('div', `text-xs ${j.enabled ? 'text-accent' : 'text-gray-500'}`, j.enabled ? '\u25CF' : '\u25CB'),
      );
      container.appendChild(row);
    }
  }
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

async function refreshAll() {
  log('Refreshing...');
  await Promise.all([
    updateSystem(),
    updateSessions(),
    updateServices(),
    updateNetwork(),
    updateCrons(),
  ]);
  setText('last-update', new Date().toLocaleString());
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  await loadConfig();
  setInterval(updateTime, 1000);
  updateTime();
  await refreshAll();
  setInterval(refreshAll, refreshInterval);
}

init();
