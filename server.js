#!/usr/bin/env node
/**
 * OpenClaw Monitoring Dashboard
 * A lightweight, real-time monitoring dashboard for OpenClaw deployments
 *
 * @version 1.1.0
 * @see https://github.com/openclaw/openclaw
 */

const http = require('http');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * @param {'error'|'warn'|'info'|'debug'} level
 */
function createLogger(level = 'info') {
  const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  const ts = () => new Date().toISOString();
  return {
    error: (...args) =>
      threshold >= LOG_LEVELS.error &&
      console.error(`[${ts()}] ERROR`, ...args),
    warn: (...args) =>
      threshold >= LOG_LEVELS.warn &&
      console.warn(`[${ts()}] WARN `, ...args),
    info: (...args) =>
      threshold >= LOG_LEVELS.info &&
      console.log(`[${ts()}] INFO `, ...args),
    debug: (...args) =>
      threshold >= LOG_LEVELS.debug &&
      console.log(`[${ts()}] DEBUG`, ...args),
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  port: 5190,
  host: '0.0.0.0',
  refreshInterval: 10000,
  dashboardTitle: 'OpenClaw Dashboard',
  logLevel: 'info',
  auth: { token: null },
  cors: { allowedOrigins: [] },
  openclaw: { gatewayUrl: 'http://localhost:31418' },
  services: [],
  hosts: [],
  quickLinks: [],
};

let config = DEFAULT_CONFIG;
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    config = {
      ...DEFAULT_CONFIG,
      ...user,
      auth: { ...DEFAULT_CONFIG.auth, ...user.auth },
      cors: { ...DEFAULT_CONFIG.cors, ...user.cors },
      openclaw: { ...DEFAULT_CONFIG.openclaw, ...user.openclaw },
    };
  }
} catch (e) {
  console.error('Error loading config:', e.message);
}

const log = createLogger(config.logLevel);
const PORT = process.env.PORT || config.port;
const HOST = process.env.HOST || config.host;

if (!fs.existsSync(CONFIG_PATH)) {
  log.info(
    'No config.json found, using defaults. Copy config.example.json to config.json to customize.',
  );
}

// ---------------------------------------------------------------------------
// Response cache (avoids repeated shell calls within a short window)
// ---------------------------------------------------------------------------

const cache = new Map();
const CACHE_TTL = 5000; // 5 seconds

/** @param {string} key */
function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  return null;
}

/** @param {string} key @param {*} data */
function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// ---------------------------------------------------------------------------
// Rate limiting (per-IP, 60 req / min)
// ---------------------------------------------------------------------------

const rateMap = new Map();
const RATE_LIMIT = 60;
const RATE_WINDOW = 60_000;

/** @param {string} ip @returns {boolean} */
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateMap.set(ip, { count: 1, start: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Sweep stale entries every 5 min
const rateSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now - entry.start > RATE_WINDOW) rateMap.delete(ip);
  }
}, 300_000);
rateSweepTimer.unref();

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

/** @param {http.IncomingMessage} req */
function getCorsHeaders(req) {
  const origin = req.headers.origin;
  const allowed = config.cors.allowedOrigins;

  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (allowed.length === 0) {
    // No explicit allowlist — mirror the request origin (same-origin friendly)
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
  } else if (allowed.includes('*')) {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/** @param {http.IncomingMessage} req @returns {boolean} */
function checkAuth(req) {
  const token = config.auth?.token;
  if (!token) return true;

  const header = req.headers.authorization;
  if (!header) return false;

  const [scheme, value] = header.split(' ');
  return scheme === 'Bearer' && value === token;
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

/**
 * Run a shell command string (only use for hardcoded commands).
 * @param {string} cmd
 * @param {number} timeout
 * @returns {Promise<string|null>}
 */
async function run(cmd, timeout = 10_000) {
  try {
    const { stdout } = await execAsync(cmd, { timeout });
    return stdout.trim();
  } catch (e) {
    log.debug(`Shell command failed: ${cmd}`, e.message);
    return null;
  }
}

/**
 * Run an executable with an argument array (safe from injection).
 * @param {string} cmd
 * @param {string[]} args
 * @param {number} timeout
 * @returns {Promise<string|null>}
 */
async function runFile(cmd, args, timeout = 10_000) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout });
    return stdout.trim();
  } catch (e) {
    log.debug(`execFile failed: ${cmd} ${args.join(' ')}`, e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/** @param {string} str @returns {boolean} */
function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** @param {string} str @returns {boolean} */
function isValidHostname(str) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(str);
}

// ---------------------------------------------------------------------------
// API Handlers
// ---------------------------------------------------------------------------

async function getSystem() {
  const cached = getCached('system');
  if (cached) return cached;

  const [cpu, mem, disk, uptime] = await Promise.all([
    run("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"),
    run("free -h | awk '/^Mem:/ {print $3\"|\"$2\"|\"$3/$2*100}'"),
    run("df -h / | awk 'NR==2 {print $3\"|\"$2\"|\"$5}'"),
    run('uptime -p'),
  ]);

  const memParts = mem?.split('|') || ['--', '--', '0'];
  const diskParts = disk?.split('|') || ['--', '--', '0'];

  const result = {
    cpu: parseFloat(cpu) || 0,
    memoryUsed: memParts[0],
    memoryTotal: memParts[1],
    memoryPct: parseFloat(memParts[2]) || 0,
    diskUsed: diskParts[0],
    diskTotal: diskParts[1],
    diskPct: parseFloat(diskParts[2]) || 0,
    uptime: uptime?.replace('up ', '') || '--',
  };

  setCache('system', result);
  return result;
}

async function getSessions() {
  const cached = getCached('sessions');
  if (cached) return cached;

  try {
    const url = config.openclaw.gatewayUrl + '/api/sessions';
    if (!isValidUrl(url)) {
      log.warn('Invalid gateway URL for sessions');
      return { sessions: [] };
    }
    const result = await runFile('curl', ['-s', url]);
    if (result) {
      const data = JSON.parse(result);
      const sessions = {
        sessions: (data.sessions || []).map((s) => ({
          name: s.label || s.displayName || s.key,
          channel: s.channel || 'unknown',
          tokens: s.totalTokens || 0,
          updated: s.updatedAt,
        })),
      };
      setCache('sessions', sessions);
      return sessions;
    }
  } catch (e) {
    log.error('Failed to fetch sessions:', e.message);
  }
  return { sessions: [] };
}

async function getServices() {
  const cached = getCached('services');
  if (cached) return cached;

  const defaultServices = [
    {
      name: 'OpenClaw Gateway',
      port: config.openclaw.gatewayUrl.split(':').pop(),
      healthPath: '/health',
    },
  ];

  const allServices = [...defaultServices, ...config.services];

  const results = await Promise.all(
    allServices.map(async (svc) => {
      const url =
        svc.url || `http://localhost:${svc.port}${svc.healthPath || '/'}`;
      if (!isValidUrl(url)) {
        log.warn(`Invalid service URL for ${svc.name}: ${url}`);
        return { name: svc.name, port: svc.port, status: 'down' };
      }
      // Use execFile (argument array) to avoid shell injection
      const code = await runFile(
        'curl',
        ['-s', '-o', '/dev/null', '-w', '%{http_code}', url],
        5000,
      );
      return {
        name: svc.name,
        port: svc.port,
        status: code === '200' || code === '404' ? 'up' : 'down',
      };
    }),
  );

  const result = { services: results };
  setCache('services', result);
  return result;
}

async function getNetwork() {
  if (!config.hosts || config.hosts.length === 0) {
    return { hosts: [] };
  }

  const cached = getCached('network');
  if (cached) return cached;

  const results = await Promise.all(
    config.hosts.map(async (host) => {
      if (!isValidHostname(host.ip)) {
        log.warn(`Invalid hostname/IP skipped: ${host.ip}`);
        return { name: host.name, ip: host.ip, status: 'offline' };
      }
      // Use execFile to prevent injection via host.ip
      const result = await runFile(
        'ping',
        ['-c', '1', '-W', '1', host.ip],
        3000,
      );
      return {
        name: host.name,
        ip: host.ip,
        status: result !== null ? 'online' : 'offline',
      };
    }),
  );

  const networkResult = { hosts: results };
  setCache('network', networkResult);
  return networkResult;
}

async function getCrons() {
  const cached = getCached('crons');
  if (cached) return cached;

  try {
    const url = config.openclaw.gatewayUrl + '/api/cron';
    if (!isValidUrl(url)) {
      log.warn('Invalid gateway URL for crons');
      return { jobs: [] };
    }
    const result = await runFile('curl', ['-s', url]);
    if (result) {
      const data = JSON.parse(result);
      const crons = {
        jobs: (data.jobs || []).map((j) => ({
          name: j.name || j.id,
          schedule: j.schedule?.expr || j.schedule?.kind || '--',
          enabled: j.enabled,
          lastRun: j.state?.lastRunAtMs,
          lastStatus: j.state?.lastStatus,
        })),
      };
      setCache('crons', crons);
      return crons;
    }
  } catch (e) {
    log.error('Failed to fetch crons:', e.message);
  }
  return { jobs: [] };
}

async function getConfig() {
  return {
    refreshInterval: config.refreshInterval,
    dashboardTitle: config.dashboardTitle,
    quickLinks: config.quickLinks || [],
  };
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const STATIC_DIR = __dirname;
const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** @param {http.ServerResponse} res @param {string} filePath */
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  if (!CONTENT_TYPES[ext]) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientIp = req.socket.remoteAddress;

  // Rate limiting
  if (isRateLimited(clientIp)) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': '60',
    });
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  // Health endpoint (no auth required)
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // API routes
  if (url.pathname.startsWith('/api/')) {
    if (!checkAuth(req)) {
      res.writeHead(401, getCorsHeaders(req));
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let data;
    const headers = getCorsHeaders(req);

    switch (url.pathname) {
      case '/api/system':
        data = await getSystem();
        break;
      case '/api/sessions':
        data = await getSessions();
        break;
      case '/api/services':
        data = await getServices();
        break;
      case '/api/network':
        data = await getNetwork();
        break;
      case '/api/crons':
        data = await getCrons();
        break;
      case '/api/config':
        data = await getConfig();
        break;
      default:
        res.writeHead(404, headers);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

    res.writeHead(200, headers);
    res.end(JSON.stringify(data));
    return;
  }

  // Static files
  if (url.pathname === '/' || url.pathname === '/index.html') {
    serveStatic(res, path.join(STATIC_DIR, 'index.html'));
  } else {
    // Prevent directory traversal
    const safePath = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    serveStatic(res, path.join(STATIC_DIR, safePath));
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  log.info(`OpenClaw Dashboard running at http://${HOST}:${PORT}`);
  log.info(`Local: http://localhost:${PORT}/`);
  if (HOST === '0.0.0.0') {
    log.info(`Network: http://<your-ip>:${PORT}/`);
  }
  if (config.auth?.token) {
    log.info('Authentication enabled');
  }
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  log.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    log.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    log.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Exports for testing
module.exports = {
  server,
  config,
  isValidUrl,
  isValidHostname,
  getCached,
  setCache,
  checkAuth,
  isRateLimited,
  handleRequest,
};
