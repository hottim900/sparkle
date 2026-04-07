[繁體中文](README.zh-TW.md)

# Sparkle

A self-hosted PKM frontend for Obsidian. Sparkle provides fast capture interfaces (PWA, LINE Bot, Claude Code via MCP) that feed into a Zettelkasten maturity flow, with the Obsidian vault as the long-term knowledge destination. Sparkle handles capture, triage, and task management; Obsidian handles deep reading and reflection.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/hottim900/sparkle/pulls)

## Features

- **Zettelkasten Note Flow** -- Notes mature through stages: Fleeting -> Developing -> Permanent -> Exported to Obsidian
- **GTD Task Management** -- Quick-capture todos with priority levels, due dates, and tag organization
- **Pause & Resume** -- Shelve notes and todos without archiving; paused items stay out of stale/attention alerts but remain searchable, with optional context memos for when you return
- **Categories** -- Organize notes and todos into color-coded categories with drag-and-drop reordering
- **Dashboard & Week View** -- Activity overview with weekly breakdown of notes and todos
- **Private Notes** -- PIN-protected notes hidden from default views and search
- **Daily Note Generation** -- Auto-generate Obsidian daily notes from Sparkle activity; LINE push notifications for daily briefs
- **PWA with Offline Support** -- Install on any device; captures queue offline and sync when reconnected
- **LINE Bot Integration** -- Capture ideas and manage tasks directly from LINE chat
- **Vault Browse & Search** -- Browse your entire Obsidian vault from within Sparkle; full-text search across vault files; filter by Sparkle-sourced files
- **Multi-line Quick Capture** -- Capture longer thoughts with a multi-line textarea; server auto-derives titles from content
- **Obsidian Export & Sync** -- Export permanent notes as Markdown with YAML frontmatter into your vault; exported content stays in sync
- **Sharing** -- Generate public or unlisted links for individual notes with TOC, back-to-top, and last-modified date
- **Scratch Pad** -- Temporary drafts for quick fragments that don't need the Zettelkasten flow
- **Full-Text Search** -- SQLite FTS5 with trigram tokenizer for fast Chinese/English search
- **Dark / Light Mode** -- Automatic theme switching with manual override
- **Mobile-First Responsive** -- Optimized for quick capture on mobile, rich editing on desktop

## Tech Stack

| Category   | Technology                                            |
| ---------- | ----------------------------------------------------- |
| Frontend   | React 19, TypeScript, Tailwind CSS, shadcn/ui (Radix) |
| Backend    | Hono, Node.js, Drizzle ORM, better-sqlite3            |
| PWA        | vite-plugin-pwa, Workbox, IndexedDB offline queue     |
| Validation | Zod (API + frontend)                                  |
| Search     | SQLite FTS5 (trigram tokenizer)                       |
| Build      | Vite                                                  |

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
- **Obsidian Integration** -- Export permanent notes to your vault, browse vault files, and search across your knowledge base. Configure via the Settings page in the web UI.
- **MCP Server for Claude Code** -- Enable Claude Code to read and write Sparkle notes via the Model Context Protocol. See [Self-Hosting Guide: MCP Server](docs/self-hosting.md#mcp-server-for-claude-code-optional).

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

## License

[MIT](LICENSE)
