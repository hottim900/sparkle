#!/usr/bin/env bash
# Usage: sudo bash scripts/upgrade-node-runtime.sh /absolute/path/to/node [--dry-run]
# Installs runtime-only systemd overrides without replacing local service settings.
set -euo pipefail

NODE_RUNTIME="${1:?Provide the absolute path to the patched Node executable}"
DRY_RUN="${2:-}"
if [[ "$NODE_RUNTIME" != /* || "$NODE_RUNTIME" =~ [[:space:]\"\\%] || ! -x "$NODE_RUNTIME" ]]; then
  echo "ERROR: Node must be an executable absolute path without whitespace, quotes, backslashes or %." >&2
  exit 1
fi
if [[ -n "$DRY_RUN" && "$DRY_RUN" != --dry-run ]]; then
  echo "ERROR: the only optional argument is --dry-run" >&2
  exit 1
fi
if [[ "$DRY_RUN" != --dry-run && "$EUID" != 0 ]]; then
  echo "ERROR: run with sudo to update systemd." >&2
  exit 1
fi

"$NODE_RUNTIME" -e '
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  if (major !== 22 || minor < 23 || (minor === 23 && patch < 4)) {
    console.error("ERROR: Node 22.23.4 or later in the 22.x line is required.");
    process.exit(1);
  }
'

SPARKLE_DIR="$(systemctl show sparkle.service --property=WorkingDirectory --value)"
MCP_DIR="$(systemctl show sparkle-mcp-http.service --property=WorkingDirectory --value)"
if [[ -z "$SPARKLE_DIR" || "$MCP_DIR" != "$SPARKLE_DIR/mcp-server" || "$SPARKLE_DIR" =~ [[:space:]\"\\%] ]]; then
  echo "ERROR: unexpected Sparkle service working directories." >&2
  exit 1
fi

for unit in sparkle sparkle-mcp-http; do
  if [[ "$unit" == sparkle ]]; then
    command_line="$NODE_RUNTIME --env-file=.env --import tsx server/index.ts"
  else
    command_line="$NODE_RUNTIME --env-file=$SPARKLE_DIR/.env dist/http.js"
  fi
  override_dir="/etc/systemd/system/$unit.service.d"
  override="[Service]
Environment=PATH=$(dirname "$NODE_RUNTIME"):/usr/bin
ExecStart=
ExecStart=$command_line"
  if [[ "$DRY_RUN" == --dry-run ]]; then
    printf '%s\n%s\n' "$override_dir/90-node-runtime.conf" "$override"
  else
    install -d -m 755 "$override_dir"
    if [[ -f "$override_dir/90-node-runtime.conf" ]]; then
      cp -p "$override_dir/90-node-runtime.conf" "$override_dir/90-node-runtime.conf.bak"
    fi
    printf '%s\n' "$override" > "$override_dir/90-node-runtime.conf"
    chmod 644 "$override_dir/90-node-runtime.conf"
  fi
done

if [[ "$DRY_RUN" != --dry-run ]]; then
  systemctl daemon-reload
  systemctl restart sparkle sparkle-mcp-http
  systemctl is-active --quiet sparkle
  systemctl is-active --quiet sparkle-mcp-http
  echo "Both Sparkle services are active."
fi
