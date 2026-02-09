# Contributing to OpenClaw Dashboard

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/AXSLV24-JP/openclaw-dashboard.git
cd openclaw-dashboard
npm install
cp config.example.json config.json
npm run dev
```

## Project Structure

| File | Purpose |
|------|---------|
| `server.js` | HTTP server, API endpoints, auth, caching |
| `index.html` | Dashboard HTML layout (Tailwind CSS) |
| `dashboard.js` | Frontend logic (DOM manipulation, API calls) |
| `config.example.json` | Configuration template |
| `test/` | Unit tests (Node.js built-in test runner) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server |
| `npm run dev` | Start with auto-reload |
| `npm test` | Run unit tests |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format code with Prettier |

## Guidelines

1. **Keep it lightweight** — this project has zero runtime dependencies by design.
2. **Security first** — never use `innerHTML` with untrusted data; use `execFile` instead of `exec` for user-controlled inputs.
3. **Test your changes** — run `npm test` before submitting a PR.
4. **Lint your code** — run `npm run lint` and fix any issues.

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Make your changes
4. Run `npm test && npm run lint`
5. Commit with a clear message
6. Open a pull request

## Reporting Issues

Open an issue at [GitHub Issues](https://github.com/AXSLV24-JP/openclaw-dashboard/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
