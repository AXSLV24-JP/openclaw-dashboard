#!/usr/bin/env node
/**
 * OpenClaw Monitoring Dashboard
 * A lightweight, real-time monitoring dashboard for OpenClaw deployments
 * 
 * https://github.com/openclaw/openclaw
 */

const http = require('http');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

// Load config
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  port: 5190,
  host: '0.0.0.0',
  refreshInterval: 10000,
  dashboardTitle: 'OpenClaw Dashboard',
  openclaw: {
    gatewayUrl: 'http://localhost:31418'
  },
  services: [],
  hosts: [],
  quickLinks: []
};

let config = DEFAULT_CONFIG;
try {
  if (fs.existsSync(CONFIG_PATH)) {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } else {
    console.log('No config.json found, using defaults. Copy config.example.json to config.json to customize.');
  }
} catch (e) {
  console.error('Error loading config:', e.message);
}

const PORT = process.env.PORT || config.port;
const HOST = process.env.HOST || config.host;

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Execute shell command safely
async function run(cmd, timeout = 10000) {
  try {
    const { stdout } = await execAsync(cmd, { timeout });
    return stdout.trim();
  } catch (e) {
    return null;
  }
}

// API Handlers
async function getSystem() {
  const [cpu, mem, disk, uptime] = await Promise.all([
    run("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"),
    run("free -h | awk '/^Mem:/ {print $3\"|\"$2\"|\"$3/$2*100}'"),
    run("df -h / | awk 'NR==2 {print $3\"|\"$2\"|\"$5}'"),
    run("uptime -p")
  ]);

  const memParts = mem?.split('|') || ['--', '--', '0'];
  const diskParts = disk?.split('|') || ['--', '--', '0'];

  return {
    cpu: parseFloat(cpu) || 0,
    memoryUsed: memParts[0],
    memoryTotal: memParts[1],
    memoryPct: parseFloat(memParts[2]) || 0,
    diskUsed: diskParts[0],
    diskTotal: diskParts[1],
    diskPct: parseFloat(diskParts[2]) || 0,
    uptime: uptime?.replace('up ', '') || '--'
  };
}

async function getSessions() {
  try {
    const result = await run(`curl -s ${config.openclaw.gatewayUrl}/api/sessions`);
    if (result) {
      const data = JSON.parse(result);
      return {
        sessions: (data.sessions || []).map(s => ({
          name: s.label || s.displayName || s.key,
          channel: s.channel || 'unknown',
          tokens: s.totalTokens || 0,
          updated: s.updatedAt
        }))
      };
    }
  } catch (e) {}
  return { sessions: [] };
}

async function getServices() {
  const defaultServices = [
    { name: 'OpenClaw Gateway', port: config.openclaw.gatewayUrl.split(':').pop(), healthPath: '/health' }
  ];
  
  const allServices = [...defaultServices, ...config.services];
  
  const results = await Promise.all(allServices.map(async (svc) => {
    const url = svc.url || `http://localhost:${svc.port}${svc.healthPath || '/'}`;
    const code = await run(`curl -s -o /dev/null -w "%{http_code}" "${url}"`, 5000);
    return {
      name: svc.name,
      port: svc.port,
      status: (code === '200' || code === '404') ? 'up' : 'down'
    };
  }));

  return { services: results };
}

async function getNetwork() {
  if (!config.hosts || config.hosts.length === 0) {
    return { hosts: [] };
  }

  const results = await Promise.all(config.hosts.map(async (host) => {
    const ping = await run(`ping -c 1 -W 1 ${host.ip} 2>/dev/null && echo OK || echo FAIL`, 3000);
    return {
      name: host.name,
      ip: host.ip,
      status: ping?.includes('OK') ? 'online' : 'offline'
    };
  }));

  return { hosts: results };
}

async function getCrons() {
  try {
    const result = await run(`curl -s ${config.openclaw.gatewayUrl}/api/cron`);
    if (result) {
      const data = JSON.parse(result);
      return {
        jobs: (data.jobs || []).map(j => ({
          name: j.name || j.id,
          schedule: j.schedule?.expr || j.schedule?.kind || '--',
          enabled: j.enabled,
          lastRun: j.state?.lastRunAtMs,
          lastStatus: j.state?.lastStatus
        }))
      };
    }
  } catch (e) {}
  return { jobs: [] };
}

async function getConfig() {
  return {
    refreshInterval: config.refreshInterval,
    dashboardTitle: config.dashboardTitle,
    quickLinks: config.quickLinks || []
  };
}

// Serve static files
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(data);
  });
}

// Request handler
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // API routes
  if (url.pathname.startsWith('/api/')) {
    let data;
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
        res.writeHead(404, corsHeaders);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify(data));
    return;
  }

  // Static files
  const staticDir = __dirname;
  if (url.pathname === '/' || url.pathname === '/index.html') {
    serveStatic(res, path.join(staticDir, 'index.html'));
  } else {
    serveStatic(res, path.join(staticDir, url.pathname));
  }
}

// Start server
const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log(`🦞 OpenClaw Dashboard running at http://${HOST}:${PORT}`);
  console.log(`   Local:   http://localhost:${PORT}/`);
  if (HOST === '0.0.0.0') {
    console.log(`   Network: http://<your-ip>:${PORT}/`);
  }
});
