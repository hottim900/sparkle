[繁體中文](README.zh-TW.md)

# Sparkle

Self-hosted PWA for personal idea capture and task management with Zettelkasten note maturity flow.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/hottim900/sparkle/pulls)

## Features

- **Zettelkasten Note Flow** -- Notes mature through stages: Fleeting -> Developing -> Permanent -> Exported to Obsidian
- **GTD Task Management** -- Quick-capture todos with priority levels, due dates, and tag organization
- **PWA with Offline Support** -- Install on any device; captures queue offline and sync when reconnected
- **LINE Bot Integration** -- Capture ideas and manage tasks directly from LINE chat
- **Obsidian Export** -- Export permanent notes as Markdown files with YAML frontmatter into your Obsidian vault
- **Full-Text Search** -- SQLite FTS5 with trigram tokenizer for fast Chinese/English search
- **Dark / Light Mode** -- Automatic theme switching with manual override
- **Mobile-First Responsive** -- Optimized for quick capture on mobile, rich editing on desktop

## Tech Stack

| Category | Technology |
|----------|-----------|
| Frontend | React 19, TypeScript, Tailwind CSS, shadcn/ui (Radix) |
| Backend | Hono, Node.js, Drizzle ORM, better-sqlite3 |
| PWA | vite-plugin-pwa, Workbox, IndexedDB offline queue |
| Validation | Zod (API + frontend) |
| Search | SQLite FTS5 (trigram tokenizer) |
| Build | Vite |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/hottim900/sparkle.git
cd sparkle

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env and set AUTH_TOKEN to a strong random string

# Start dev servers (two terminals)
npm run dev          # Frontend: http://localhost:5173
npm run dev:server   # Backend:  http://localhost:3000
```

Open http://localhost:5173 in your browser. The Vite dev server proxies API requests to the backend automatically.

> **Note:** Node.js 22 is required (better-sqlite3 native module is incompatible with v24).

## Self-Hosting

For production deployment with HTTPS, systemd services, and optional integrations, see the [Self-Hosting Guide](docs/self-hosting.md).

## Optional Integrations

- **LINE Bot** -- Capture ideas and manage tasks from LINE chat. See [Self-Hosting Guide: LINE Bot Setup](docs/self-hosting.md#line-bot-setup-optional).
- **Obsidian Export** -- Export permanent notes to your Obsidian vault. Configure via the Settings page in the web UI.
- **MCP Server for Claude Code** -- Enable Claude Code to read and write Sparkle notes via the Model Context Protocol. See [Self-Hosting Guide: MCP Server](docs/self-hosting.md#mcp-server-for-claude-code-optional).

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

## License

[MIT](LICENSE)
