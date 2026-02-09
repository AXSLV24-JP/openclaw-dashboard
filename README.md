# OpenClaw Monitoring Dashboard 🦞

A lightweight, real-time monitoring dashboard for [OpenClaw](https://github.com/openclaw/openclaw) AI assistant deployments.

![Dashboard Preview](preview.png)

## Features

- **System Monitoring** — CPU, memory, disk usage with live progress bars
- **OpenClaw Sessions** — Active agents, token usage, channels
- **Service Status** — Monitor running services with health checks
- **Network Hosts** — Ping status for configured machines
- **Cron Jobs** — View scheduled tasks and their status
- **Quick Links** — One-click access to your services
- **Activity Log** — Recent events and updates
- **Auto-Refresh** — Configurable refresh interval (default: 10s)

## Installation

### Prerequisites

- Node.js 18+
- OpenClaw Gateway running

### Quick Start

```bash
# Clone the repo
git clone https://github.com/AXSLV24-JP/openclaw-dashboard.git
cd openclaw-dashboard

# Copy and edit config
cp config.example.json config.json
# Edit config.json with your settings

# Start the server
node server.js

# Open in browser
open http://localhost:5190
```

### Configuration

Edit `config.json` to customize:

```json
{
  "port": 5190,
  "host": "0.0.0.0",
  "refreshInterval": 10000,
  "openclaw": {
    "gatewayUrl": "http://localhost:31418"
  },
  "services": [
    { "name": "My App", "port": 3000, "healthPath": "/health" }
  ],
  "hosts": [
    { "name": "Server 1", "ip": "192.168.1.10" }
  ]
}
```

## Usage

### As Standalone

```bash
node server.js
```

### With PM2 (recommended for production)

```bash
pm2 start server.js --name openclaw-dashboard
```

### With Docker

```bash
docker build -t openclaw-dashboard .
docker run -p 5190:5190 -v ./config.json:/app/config.json openclaw-dashboard
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard UI |
| `GET /api/system` | System stats (CPU, memory, disk) |
| `GET /api/sessions` | OpenClaw sessions |
| `GET /api/services` | Service health status |
| `GET /api/network` | Network host status |
| `GET /api/crons` | Cron job list |

## Customization

### Theming

The dashboard uses Tailwind CSS. Edit `index.html` to customize colors:

```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        dark: '#0a0a0f',
        accent: '#2faa77', // Change accent color
      }
    }
  }
}
```

### Adding Services

Add services to monitor in `config.json`:

```json
{
  "services": [
    { "name": "API Server", "port": 3001, "healthPath": "/" },
    { "name": "WebSocket", "port": 3002, "healthPath": "/health" }
  ]
}
```

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT License - see [LICENSE](LICENSE)

## Links

- [OpenClaw](https://github.com/openclaw/openclaw) - The AI assistant framework
- [OpenClaw Docs](https://docs.openclaw.ai)
- [Discord Community](https://discord.com/invite/clawd)
