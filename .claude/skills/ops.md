---
name: ops
description: >
  Production deployment and operations for Sparkle. Self-hosted on WSL2 with systemd,
  Cloudflare Tunnel, WireGuard VPN. Covers auto-deploy (GitHub Actions self-hosted runner),
  environment variables, HTTPS/mkcert, iptables firewall, restic backup with offsite copy,
  LINE push alert monitoring, Cloudflare Tunnel + Access setup, systemd service management.
  Use for deployment issues, infrastructure changes, or ops tasks.
user-invocable: true
---

# Production Deployment & Operations

Self-hosted on WSL2 (mirrored networking mode) with WireGuard VPN. Managed by systemd. See `docs/self-hosting.md` for full setup instructions.

## Auto-Deploy (GitHub Actions)

- `deploy.yml` triggers via `workflow_run` after CI passes on `main`
- Runs on a **self-hosted runner** inside WSL2 (same machine as production)
- Steps: `git pull` → `npm ci` → `npm run build` → `systemctl restart sparkle` → health check
- **One-time setup required**: install self-hosted runner (`~/actions-runner/`), service name `actions.runner.hottim900-sparkle.sparkle-wsl`, configure sudoers (`/etc/sudoers.d/github-runner`) for passwordless `systemctl restart sparkle`
- Rollback: `git revert` + push triggers a new deploy

## Quick Reference

```bash
# First-time setup
sudo ./scripts/install-services.sh

# Restart
sudo ./scripts/start.sh
sudo systemctl restart sparkle sparkle-tunnel

# Status & logs
sudo systemctl status sparkle
journalctl -u sparkle -f
```

## Environment Variables (.env)

Copy `.env.example` to `.env` and fill in your values. See `.env.example` for all available variables. Key optional variables: `SENTRY_DSN` (error tracking), `TLS_CERT`/`TLS_KEY` (HTTPS), `LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN` (LINE Bot), `LINE_ADMIN_USER_ID` (monitoring alerts).

## HTTPS (mkcert) — Optional

- When behind Cloudflare Tunnel, plain HTTP on localhost is recommended (no TLS overhead)
- TLS is only needed for direct LAN access without a tunnel
- Generate certs with mkcert for your local IPs / localhost
- Install the CA root on all devices that need to access the app
- Configure cert paths in `.env` (TLS_CERT, TLS_KEY)

## Firewall

**Hyper-V Firewall**: In mirrored mode, WSL2 inbound traffic is controlled by Hyper-V firewall (default: Block). Configure via `Set-NetFirewallHyperVVMSetting` or `New-NetFirewallHyperVRule`.

**iptables** rules via `scripts/firewall.sh` provide defense-in-depth:
- `127.0.0.1` → ACCEPT (localhost / Cloudflare Tunnel)
- VPN subnet → ACCEPT (WireGuard)
- All others → DROP
- Atomic setup: all rules succeed or all rollback; gracefully skips if iptables unavailable
- Cleanup on stop via `scripts/firewall-cleanup.sh`

Requires `iptables` package: `sudo apt install -y iptables`

## Backup (restic + sqlite3)

- Run `scripts/setup-backup.sh` for interactive first-time setup (installs restic, inits repo, generates password, optionally configures offsite backup)
- `scripts/backup.sh` runs unattended: `VACUUM INTO` snapshot → `gzip --rsyncable` → `restic backup` → retention prune → offsite copy (optional)
- `VACUUM INTO` creates compacted, consistent hot snapshot (safe with WAL mode)
- `gzip --rsyncable` produces dedup-friendly output for restic incremental backups
- Retention: 7 daily, 4 weekly, 3 monthly (`--group-by host,tags`)
- Tags: `--tag db,sqlite,sparkle`
- Env vars: `RESTIC_REPOSITORY` (default `~/sparkle-backups`), `RESTIC_PASSWORD_FILE` (required), `HEALTHCHECK_URL` (optional)
- **Offsite backup**: `restic copy --tag sparkle` replicates snapshots to a second repo on a separate physical disk (e.g. `/mnt/d/sparkle-backups`). Non-fatal — warns and continues if mount point not available. Same retention policy applied to offsite repo.
- Offsite env vars: `RESTIC_OFFSITE_REPOSITORY` (e.g. `/mnt/d/sparkle-backups`), `RESTIC_OFFSITE_PASSWORD_FILE` (optional, defaults to `RESTIC_PASSWORD_FILE`)
- Offsite init: `restic init --repo /mnt/d/sparkle-backups --copy-chunker-params --repo2 ~/sparkle-backups` (shared chunker params for dedup efficiency)
- Suggested cron: `0 3 * * *` (daily at 3 AM)
- Restore: `restic restore latest --tag sparkle --target /tmp/sparkle-restore` → `gunzip` → stop service → copy DB → remove stale WAL/SHM → `chown` → start service

## Monitoring (LINE Push Alerts)

- `scripts/health-monitor.sh`: Health check via `curl /api/health`. First failure sends LINE alert, subsequent failures suppressed via `/tmp/sparkle-health-alert-sent` flag file. Recovery clears flag and sends recovery notification.
- `scripts/error-summary.sh`: Scans `journalctl -u sparkle` for pino ERROR (level 50) and FATAL (level 60) in the past hour. Sends LINE push summary if count > 0. Requires `jq`.
- Both scripts read `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_ADMIN_USER_ID` from `.env`. Missing vars = silent exit.
- LINE Push Message API: `POST https://api.line.me/v2/bot/message/push` with Bearer token auth
- Suggested cron:
  - `*/5 * * * * /home/tim/sparkle/scripts/health-monitor.sh 2>&1 | logger -t sparkle-health`
  - `0 * * * * /home/tim/sparkle/scripts/error-summary.sh 2>&1 | logger -t sparkle-errors`

## Cloudflare Tunnel + Access

- Run `scripts/setup-cloudflared.sh` for interactive setup (new tunnel only; existing tunnels already have separate configs)
- **Default: plain HTTP** between cloudflared and Sparkle (both on localhost, TLS unnecessary)
- Full service exposed through Tunnel; access controlled by **Cloudflare Access** (Zero Trust)
- `/api/webhook/*` bypasses CF Access (LINE Bot needs direct access)
- Config stored in `~/.cloudflared/`, template at `scripts/cloudflared-config.yml.template`
- **Deployed configs are per-tunnel** (e.g., `sparkle-config.yml`, `lanshare-config.yml`), separate from the repo template
- `sparkle-tunnel.service` references `~/.cloudflared/sparkle-config.yml` directly
- Setup guide: `docs/cloudflare-access-setup.md`
