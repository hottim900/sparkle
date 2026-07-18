#!/usr/bin/env bash

set -uo pipefail

INPUT=$(cat)
PATCH=$(printf "%s" "$INPUT" | node -e '
  const fs = require("node:fs");
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    console.error("migration-safety: invalid PostToolUse JSON");
    process.exit(1);
  }
  if (typeof input.tool_input !== "string") process.exit(2);
  process.stdout.write(input.tool_input);
')
PARSE_STATUS=$?
case "$PARSE_STATUS" in
  0) ;;
  2) exit 0 ;;
  *)
    echo "migration-safety: unable to parse PostToolUse input" >&2
    exit 1
    ;;
esac

if ! printf "%s\n" "$PATCH" | grep -Eq \
  '^\*\*\* (Add|Update|Delete) File: (\./)?server/db/index\.ts$|^\*\*\* Move to: (\./)?server/db/index\.ts$'; then
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "migration-safety: unable to resolve repository root" >&2
  exit 1
}
cd "$REPO_ROOT" || exit 1

if OUTPUT=$(npx vitest run server/db/__tests__/migration*.test.ts 2>&1); then
  exit 0
fi

OUTPUT=$(printf "%s\n" "$OUTPUT" | tail -n 120)
MESSAGE="Migration checks failed after editing server/db/index.ts."
CONTEXT="${MESSAGE}

Fix the failure before continuing:
${OUTPUT}"

RESPONSE=$(printf "%s" "$CONTEXT" | node -e '
  const fs = require("node:fs");
  const context = fs.readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: "Migration checks failed after editing server/db/index.ts.",
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: context,
    },
  }));
')
RESPONSE_STATUS=$?
if [ "$RESPONSE_STATUS" -ne 0 ]; then
  echo "migration-safety: unable to serialize hook failure" >&2
  exit 1
fi
printf "%s\n" "$RESPONSE"
