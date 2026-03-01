---
name: mcp-server
description: >
  MCP server for Claude Code integration with Sparkle. stdio transport, 10 tools
  (search, CRUD, workflow, stats, guide), knowledge layer, build/dev/test commands,
  registration via claude mcp add. Use when working on mcp-server/ code or debugging
  Claude Code integration.
user-invocable: true
---

# MCP Server (Claude Code Integration)

- MCP server in `mcp-server/` enables Claude Code to read/write Sparkle notes via REST API
- Config: user-scoped in `~/.claude.json`
- Transport: stdio (subprocess of Claude Code)
- **Knowledge layer**: Server `instructions` auto-injected into system prompt (role definition, Zettelkasten workflow, tool usage patterns). 7 MCP Resources at `sparkle://docs/*` for deep reference. `sparkle_guide` tool as fallback.
- 10 tools: sparkle_search, sparkle_get_note, sparkle_list_notes, sparkle_create_note, sparkle_update_note, sparkle_advance_note, sparkle_export_to_obsidian, sparkle_get_stats, sparkle_list_tags, sparkle_guide
- sparkle_create_note supports all 3 types (note/todo/scratch) with priority, due, linked_note_id
- sparkle_update_note supports type conversion, priority, due, linked_note_id, partial content edit (old_content + content for find-and-replace)
- Build: `cd mcp-server && npm install && npm run build`
- Dev: `cd mcp-server && npm run dev`
- Test: `cd mcp-server && npx @modelcontextprotocol/inspector node dist/index.js`
- Registration example:
  ```bash
  claude mcp add sparkle --transport stdio --scope user \
    --env SPARKLE_AUTH_TOKEN=<token> \
    --env SPARKLE_API_URL=http://localhost:3000 \
    -- node /path/to/sparkle/mcp-server/dist/index.js
  ```
- If Sparkle uses HTTPS (direct LAN access without tunnel), add `--env NODE_TLS_REJECT_UNAUTHORIZED=0` and change URL to `https://`
- Note: Use the full node path if nvm is not available in non-interactive shells
