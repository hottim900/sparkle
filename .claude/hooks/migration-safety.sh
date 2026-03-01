#!/bin/bash
# migration-safety.sh — PostToolUse hook
# Blocks SELECT * in migration code (column order mismatch risk)
# and shows production DB schema for reference.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only check server/db/index.ts
[[ "$FILE_PATH" == */server/db/index.ts ]] || exit 0

# Check for SELECT * FROM items in migration context (ignore comments)
if grep -n 'SELECT \* FROM items' "$FILE_PATH" | grep -qv '^\s*//\|^\s*\*'; then
  echo "❌ 禁止在 migration 中使用 SELECT * FROM items" >&2
  echo "   ALTER TABLE 追加的欄位在表尾，和 CREATE TABLE 定義順序不同。" >&2
  echo "   必須顯式列出所有欄位名。" >&2
  echo "" >&2
  echo "   範例:" >&2
  echo "   INSERT INTO items_new (id, type, title, ...) SELECT id, type, title, ... FROM items;" >&2
  echo "" >&2
  if [ -f "${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$(dirname "$0")")")}/data/todo.db" ]; then
    DB_PATH="${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$(dirname "$0")")")}/data/todo.db"
    echo "生產 DB 實際 schema (欄位順序以此為準):" >&2
    sqlite3 "$DB_PATH" ".schema items" 2>/dev/null | head -20 >&2
  fi
  exit 2
fi

exit 0
