---
name: line-bot
description: >
  LINE Bot integration for Sparkle. Complete command reference (create, query, advance,
  operate items), session mechanism with numbered items and 10-min TTL, natural language
  date parsing (chrono-node zh.hant), webhook config. Use when developing LINE Bot features
  or debugging webhook. Key files: server/routes/webhook.ts, server/lib/line*.ts.
user-invocable: true
---

# LINE Bot

- LINE Official Account with Messaging API enabled
- Webhook URL: `https://YOUR_DOMAIN/api/webhook/line`
- Commands:
  - 新增：`!todo`=待辦, `!high`=高優先, `!tmp <內容>`=暫存, 直接輸入=閃念筆記
  - 查詢：`!fleeting`=閃念筆記, `!developing`=發展中, `!permanent`=永久筆記, `!active`=進行中待辦, `!scratch`/`!s`=暫存項目, `!notes`=所有筆記, `!todos`=所有待辦, `!today`=今日焦點, `!find <keyword>`=搜尋, `!list <tag>`=標籤篩選, `!stats`=統計
  - 筆記推進（需先查詢建立 session）：`!develop N`=閃念→發展中, `!mature N`=發展中→永久, `!export N`=匯出到 Obsidian
  - 暫存操作（需先查詢建立 session）：`!delete N`=刪除項目, `!upgrade N`=暫存升級為閃念筆記
  - 操作（需先查詢建立 session）：`!detail N`=詳情, `!due N <日期>`=設到期日(待辦only), `!track N [日期]`=從筆記建立追蹤待辦, `!tag N <標籤...>`=加標籤, `!untag N <標籤...>`=移除標籤, `!done N`=待辦完成, `!archive N`=封存, `!priority N <high|medium|low|none>`=優先度
  - `?`/`help`/`說明`=說明
  - `!inbox` 為 `!fleeting` 的向後相容別名
- Session: 查詢結果以 [N] 編號，後續用編號操作，10 分鐘 TTL，純記憶體
- Date parsing: chrono-node zh.hant，支援「明天」「3天後」「下週一」「3/15」「清除」
- Quick reply buttons shown after each response
- Chat mode must be OFF, Webhook must be ON in LINE Official Account Manager
