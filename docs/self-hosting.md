[繁體中文](self-hosting.zh-TW.md)

# Self-Hosting Guide

This guide covers deploying Sparkle as a production server with HTTPS, optional LINE Bot integration, Obsidian export, and more.

## Prerequisites

- **Node.js 22+** (better-sqlite3 is incompatible with Node 24)
- **npm**
- **Linux** recommended (also works on macOS and WSL2)

## Installation

```bash
git clone https://github.com/hottim900/sparkle.git
cd sparkle

# Install dependencies and build
npm install
npm run build
```

The `npm run build` step compiles the frontend into `dist/`, which the production server serves as static files.

## Configuration

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | Yes | Server port (default: `3000`) |
| `DATABASE_URL` | Yes | Path to SQLite database file (e.g., `./data/todo.db`) |
| `AUTH_TOKEN` | Yes | Bearer token for web UI authentication. Choose a strong random string. |
| `TLS_CERT` | No | Path to TLS certificate file. Omit to run plain HTTP. |
| `TLS_KEY` | No | Path to TLS private key file. Omit to run plain HTTP. |
| `LINE_CHANNEL_SECRET` | No | LINE Messaging API channel secret. Required for LINE Bot. |
| `LINE_CHANNEL_ACCESS_TOKEN` | No | LINE Messaging API access token. Required for LINE Bot. |

The database file and its parent directory are created automatically on first run.

## HTTPS Setup (mkcert)

HTTPS is optional but recommended, especially for PWA installation on mobile devices.

1. Install [mkcert](https://github.com/FiloSottile/mkcert):

   ```bash
   # macOS
   brew install mkcert

   # Linux (Debian/Ubuntu)
   sudo apt install libnss3-tools
   curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
   chmod +x mkcert-v*-linux-amd64
   sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
   ```

2. Install the local CA and generate certificates:

   ```bash
   mkcert -install
   mkdir -p certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1
   ```

   To access from other devices on your LAN, include the LAN IP:

   ```bash
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1 YOUR_LAN_IP
   ```

3. Update `.env`:

   ```
   TLS_CERT=./certs/cert.pem
   TLS_KEY=./certs/key.pem
   ```

4. Install the CA certificate on mobile devices:
   - The CA root is at `~/.local/share/mkcert/rootCA.pem`
   - **iOS**: AirDrop or email the file, install via Settings > General > VPN & Device Management, then enable in Settings > General > About > Certificate Trust Settings
   - **Android**: Copy to device, install via Settings > Security > Install from storage

## Running

```bash
npm start
```

The server starts on the configured port. If TLS is configured, it runs HTTPS; otherwise plain HTTP.

- HTTPS: `https://localhost:3000`
- HTTP: `http://localhost:3000`

## Systemd Service (Optional)

For automatic startup on Linux, use the included systemd service template.

1. Edit the service file to match your system:

   ```bash
   # Copy the template
   sudo cp scripts/systemd/sparkle.service /etc/systemd/system/

   # Edit — replace YOUR_USER with your Linux username
   # and verify the Node.js path (run `which node` to find it)
   sudo nano /etc/systemd/system/sparkle.service
   ```

2. Enable and start:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable sparkle
   sudo systemctl start sparkle
   ```

3. Verify:

   ```bash
   sudo systemctl status sparkle
   journalctl -u sparkle -f    # Tail logs
   ```

## LINE Bot Setup (Optional)

The LINE Bot lets you capture ideas and manage tasks directly from LINE chat.

### 1. Create a LINE Channel

1. Go to the [LINE Developers Console](https://developers.line.biz/)
2. Create a new Provider (or use an existing one)
3. Create a new **Messaging API** channel
4. In the channel settings, note the **Channel secret** and issue a **Channel access token (long-lived)**

### 2. Configure Environment

Add to your `.env`:

```
LINE_CHANNEL_SECRET=your-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-channel-access-token
```

### 3. Set the Webhook URL

The LINE webhook endpoint is `https://YOUR_DOMAIN/api/webhook/line`.

Since the webhook must be publicly accessible, you need one of:
- A public domain pointing to your server
- A Cloudflare Tunnel (see next section)
- A reverse proxy (nginx, Caddy, etc.)

In the LINE Developers Console:
1. Go to your channel's **Messaging API** tab
2. Set the **Webhook URL** to your public endpoint
3. Click **Verify** to test the connection
4. Enable **Use webhook**
5. Disable **Auto-reply messages** (under LINE Official Account Manager > Response settings)

### 4. Available Commands

| Command | Description |
|---------|-------------|
| `!todo <text>` | Create a todo |
| `!high <text>` | Create a high-priority todo |
| (plain text) | Create a fleeting note |
| `!fleeting` | List fleeting notes |
| `!developing` | List developing notes |
| `!permanent` | List permanent notes |
| `!active` | List active todos |
| `!today` | Today's focus |
| `!find <keyword>` | Search |
| `!stats` | Statistics |
| `?` / `help` | Show help |

After a query, results are numbered. Use the number to operate on items (e.g., `!detail 1`, `!done 2`, `!develop 3`).

## Cloudflare Tunnel (Optional)

A Cloudflare Tunnel exposes your Sparkle instance to the internet through Cloudflare's network. Access control is handled by **Cloudflare Access** (see next section), while the `/api/webhook/*` path is left open for LINE Bot.

An interactive setup script is included:

```bash
./scripts/setup-cloudflared.sh
```

This script will:
1. Install `cloudflared` if needed
2. Authenticate with Cloudflare
3. Create a named tunnel
4. Ask whether to use your own domain or a `cfargotunnel.com` address
5. Generate a config file that routes all traffic to the local Sparkle server
6. Optionally install as a systemd service

Alternatively, set it up manually:

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. Authenticate: `cloudflared tunnel login`
3. Create a tunnel: `cloudflared tunnel create sparkle`
4. Create `~/.cloudflared/config.yml` using `scripts/cloudflared-config.yml.template` as a reference
5. Route DNS: `cloudflared tunnel route dns sparkle sparkle.example.com`
6. Run: `cloudflared tunnel run sparkle`

> **Important**: After setting up the tunnel, you should configure Cloudflare Access to protect your Sparkle instance. See the next section.

## Cloudflare Access (Recommended with Tunnel)

If you expose Sparkle through a Cloudflare Tunnel, you should set up **Cloudflare Access** to require authentication before anyone can access the app. This replaces the need for a VPN while keeping your data secure.

Key points:
- Free for up to 50 users (no credit card required)
- Supports Email OTP, Google, GitHub, and other identity providers
- LINE Bot webhook is configured to bypass authentication
- MCP Server and localhost access are not affected

For a detailed step-by-step setup guide (in Traditional Chinese), see **[docs/cloudflare-access-setup.md](cloudflare-access-setup.md)**.

## Obsidian Integration (Optional)

Sparkle can export permanent notes as Markdown files with YAML frontmatter directly into your Obsidian vault.

1. Open Sparkle in your browser
2. Go to **Settings**
3. Enable **Obsidian Export**
4. Set the **Vault Path** to your Obsidian vault directory on the server (e.g., `/home/user/obsidian-vault/sparkle`)
5. Save

Once configured, an export button appears on permanent notes. Exported files include YAML frontmatter with tags, aliases, and timestamps.

## WSL2 Notes (Optional)

If running Sparkle inside WSL2 and accessing from the Windows host or other devices:

### Port Forwarding

After each PC reboot, the WSL2 IP changes. Run the included PowerShell script **as Administrator** to update port forwarding:

```
Right-click scripts/update-portproxy.ps1 > Run as Administrator
```

Before running, edit the script and replace `YOUR_VPN_IP` with your actual VPN or LAN IP address.

Or manually in an admin PowerShell:

```powershell
$wslIp = (wsl hostname -I).Trim().Split()[0]
netsh interface portproxy add v4tov4 listenaddress=YOUR_LAN_IP listenport=3000 connectaddress=$wslIp connectport=3000
```

### Firewall

The included `sparkle.service` template configures iptables rules to restrict port 3000 access. Adjust the allowed subnets in the service file to match your network configuration.

## MCP Server for Claude Code (Optional)

Sparkle includes an MCP (Model Context Protocol) server that lets Claude Code read, write, and manage notes.

### Build

```bash
cd mcp-server
npm install
npm run build
```

### Register with Claude Code

```bash
claude mcp add sparkle --transport stdio --scope user \
  --env SPARKLE_AUTH_TOKEN=your-auth-token \
  --env SPARKLE_API_URL=https://localhost:3000 \
  --env NODE_TLS_REJECT_UNAUTHORIZED=0 \
  -- /path/to/node /path/to/sparkle/mcp-server/dist/index.js
```

Replace `/path/to/node` with the absolute path to your Node.js binary (`which node`) and adjust the other paths accordingly. The `NODE_TLS_REJECT_UNAUTHORIZED=0` is needed if using self-signed certificates (mkcert).

### Available Tools

| Tool | Description |
|------|-------------|
| `sparkle_search` | Full-text search |
| `sparkle_get_note` | Read a single note |
| `sparkle_list_notes` | List notes with filters |
| `sparkle_create_note` | Create a new note or todo |
| `sparkle_update_note` | Update an existing item |
| `sparkle_advance_note` | Advance note maturity stage |
| `sparkle_export_to_obsidian` | Export a note to Obsidian |
| `sparkle_get_stats` | Get statistics |
| `sparkle_list_tags` | List all tags |

### Test

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node dist/index.js
```

## Updating

```bash
git pull
npm install
npm run build

# If using systemd:
sudo systemctl restart sparkle
```

If a new database migration is included, it runs automatically on server startup.
