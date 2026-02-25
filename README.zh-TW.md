[English](README.md)

# Sparkle

自架式 PWA，結合個人靈感捕捉與任務管理，搭載 Zettelkasten 筆記成熟度流程。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/hottim900/sparkle/pulls)

## 功能特色

- **Zettelkasten 筆記流程** -- 筆記依成熟度逐步推進：閃念 -> 發展中 -> 永久 -> 匯出至 Obsidian
- **GTD 任務管理** -- 快速捕捉待辦事項，支援優先度、到期日與標籤分類
- **PWA 離線支援** -- 可安裝至任何裝置；離線時自動排入佇列，連線後同步
- **LINE Bot 整合** -- 直接在 LINE 聊天中捕捉靈感、管理任務
- **Obsidian 匯出** -- 將永久筆記匯出為帶有 YAML frontmatter 的 Markdown 檔案，直接寫入 Obsidian vault
- **全文搜尋** -- SQLite FTS5 搭配 trigram tokenizer，快速搜尋中英文內容
- **深色 / 淺色模式** -- 自動切換主題，亦可手動覆寫
- **行動裝置優先的響應式設計** -- 手機上快速捕捉，桌面上豐富編輯

## 技術棧

| 類別 | 技術 |
|------|------|
| 前端 | React 19, TypeScript, Tailwind CSS, shadcn/ui (Radix) |
| 後端 | Hono, Node.js, Drizzle ORM, better-sqlite3 |
| PWA | vite-plugin-pwa, Workbox, IndexedDB 離線佇列 |
| 驗證 | Zod（API + 前端） |
| 搜尋 | SQLite FTS5（trigram tokenizer） |
| 建置 | Vite |

## 快速開始

```bash
# 複製儲存庫
git clone https://github.com/hottim900/sparkle.git
cd sparkle

# 安裝依賴套件
npm install

# 設定環境變數
cp .env.example .env
# 編輯 .env，將 AUTH_TOKEN 設為一組高強度的隨機字串

# 啟動開發伺服器（需要兩個終端機）
npm run dev          # 前端：http://localhost:5173
npm run dev:server   # 後端：http://localhost:3000
```

在瀏覽器中開啟 http://localhost:5173。Vite 開發伺服器會自動將 API 請求代理至後端。

> **注意：** 需要 Node.js 22（better-sqlite3 原生模組與 v24 不相容）。

## 自架部署

如需正式環境部署（含 HTTPS、systemd 服務及選用整合），請參閱[自架指南](docs/self-hosting.zh-TW.md)。

## 選用整合

- **LINE Bot** -- 在 LINE 聊天中捕捉靈感、管理任務。詳見[自架指南：LINE Bot 設定](docs/self-hosting.zh-TW.md#line-bot-設定選用)。
- **Obsidian 匯出** -- 將永久筆記匯出至 Obsidian vault。可在網頁 UI 的設定頁面中進行設定。
- **Claude Code MCP 伺服器** -- 讓 Claude Code 透過 Model Context Protocol 讀寫 Sparkle 筆記。詳見[自架指南：MCP 伺服器](docs/self-hosting.zh-TW.md#claude-code-mcp-伺服器選用)。

## 貢獻

歡迎貢獻！請隨時提出 issue 或送出 pull request。

## 授權

[MIT](LICENSE)
