#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# migrate-systemd-unit.sh — apply PR 2 systemd unit changes to deployed unit
#
# Pre-PR-2 unit had:   Restart=always
# Post-PR-2 unit has:  Restart=on-failure
#                      RestartPreventExitStatus=78
#                      SuccessExitStatus=78
#
# Without these, migration v24's process.exit(78) on halt will be looped by
# Restart=always — operator floods journalctl and never sees a stable halt
# window. This patcher applies the change to the deployed unit file in place.
#
# Usage: sudo bash scripts/migrate-systemd-unit.sh
# ----------------------------------------------------------------------------
set -euo pipefail

UNIT_PATH="/etc/systemd/system/sparkle.service"

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: must run as root (use sudo)"
    exit 1
fi

if [[ ! -f "$UNIT_PATH" ]]; then
    echo "ERROR: $UNIT_PATH not found"
    echo "Hint: run scripts/install-services.sh first"
    exit 1
fi

if grep -q "RestartPreventExitStatus=78" "$UNIT_PATH"; then
    echo "✅ Unit already migrated (found RestartPreventExitStatus=78). Nothing to do."
    exit 0
fi

backup="${UNIT_PATH}.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$UNIT_PATH" "$backup"
echo "📋 Backup: $backup"

# Replace `Restart=always` with the three-line block. Failing to find the line
# is fatal (the unit may have been hand-edited; refuse to touch it).
if ! grep -q "^Restart=always" "$UNIT_PATH"; then
    echo "ERROR: '$UNIT_PATH' has no 'Restart=always' line — refusing to patch automatically."
    echo "Apply changes manually: edit $UNIT_PATH and ensure these directives in [Service]:"
    echo "  Restart=on-failure"
    echo "  RestartPreventExitStatus=78"
    echo "  SuccessExitStatus=78"
    exit 1
fi

sed -i \
    -e 's|^Restart=always$|Restart=on-failure\nRestartPreventExitStatus=78\nSuccessExitStatus=78|' \
    "$UNIT_PATH"

echo "📝 Patched $UNIT_PATH"

if ! grep -q "^Restart=on-failure" "$UNIT_PATH" \
    || ! grep -q "^RestartPreventExitStatus=78" "$UNIT_PATH" \
    || ! grep -q "^SuccessExitStatus=78" "$UNIT_PATH"; then
    echo "ERROR: post-patch validation failed; restoring from backup"
    cp -p "$backup" "$UNIT_PATH"
    exit 1
fi

systemctl daemon-reload
echo "✅ systemctl daemon-reload"
echo
echo "Verify:"
echo "  systemctl cat sparkle.service | grep -E 'Restart|ExitStatus'"
echo
echo "Expected output (3 lines):"
echo "  Restart=on-failure"
echo "  RestartPreventExitStatus=78"
echo "  SuccessExitStatus=78"
