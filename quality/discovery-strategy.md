# 雙層發現策略 (Dual-Layer Discovery Strategy)

> **用途：** 定義 Sparkle 品質系統的兩層缺陷發現模型。
> Layer 1（Grep Taxonomy）用系統性搜查找結構化模式；Layer 2（Exploratory Testing）用人類判斷探索 grep 結構性找不到的盲區。

**建立日期：** 2026-04-06
**最後更新：** 2026-04-06

---

## 核心洞見

每個 grep 搜查模式在偵測特定缺陷的同時，也隱含宣告了它結構性無法偵測的範圍。這個「負空間」不是 grep 的缺陷，而是文字匹配工具的根本限制：

- grep 找得到「catch 塊裡沒有 throw」，找不到「catch 了但 handle 的方式對使用者有害」
- grep 找得到「缺少 .parse()」，找不到「schema 通過但業務規則違反」
- grep 找得到「沒有 type annotation」，找不到「type 正確但 runtime shape 已漂移」

**探索性測試 (ET) 明確映射這個負空間**，把它轉化為可執行的探索方向。兩層互相餵養：ET 發現可升格為新的 grep pattern（如果可結構化），擴大 taxonomy 覆蓋範圍，同時把 ET 推向更深的未知領域。

---

## 兩層模型

### Layer 1: Grep Taxonomy（系統性搜查）

- **工具：** `quality/defect-taxonomy.md` 的 12 個 D-XXX 類別
- **執行方式：** 每個類別的「搜查方式」提供可重複執行的 grep/搜查指令
- **優勢：** 可重複、可自動化、覆蓋面廣、零遺漏（同一 pattern 每次都找得到）
- **限制：** 只能偵測可用文字匹配表達的模式

### Layer 2: 探索性測試 (ET)

- **工具：** `quality/et-charter-template.md` 的 SBTM 模板
- **執行方式：** 人類（或 AI）帶著 charter seed 方向，在時間限制內探索系統行為
- **優勢：** 可偵測業務邏輯缺陷、跨元件互動問題、使用者體驗斷裂、和任何需要判斷力的問題
- **限制：** 不可完全重複、依賴執行者的領域知識和直覺

### Feedback Loop（回饋迴路）

```
Grep Taxonomy ──→ 定義負空間 ──→ ET Charter Seeds
     ↑                                    │
     │                                    ↓
Pattern Promotion ←── ET 發現可結構化的模式
```

1. Taxonomy 搜查完成 → 每個類別的「探索測試種子」描述 grep 找不到的方向
2. ET session 按種子方向探索 → 發現問題
3. 評估發現是否可升格為 grep pattern（見 Pattern Promotion 條件）
4. 升格的 pattern 加入 taxonomy → 新的負空間浮現 → 更新 charter seed

---

## 12 類別對照表

| 代號      | 缺陷類別               | 主要發現方法 | ET 種子焦點                                                   |
| --------- | ---------------------- | ------------ | ------------------------------------------------------------- |
| D-SILENT  | 靜默失敗與可觀測性缺口 | Grep + ET    | catch 存在但 handle 方式對使用者有害；Sentry 整合缺口         |
| D-VALID   | 輸入驗證缺口           | Grep + ET    | Zod schema 通過但業務規則違反；跨欄位依賴；時序驗證           |
| D-STATE   | 前端狀態管理不一致     | ET 為主      | React Query cache 跨 query 一致性；optimistic update rollback |
| D-OFFLINE | 離線同步與 PWA 問題    | ET 為主      | SW cache poisoning；offline queue 重播順序；網路切換          |
| D-QUERY   | 查詢語意錯誤           | Grep + ET    | NULL 在 WHERE 中的語意；FTS5 排名不一致；paused flag 交互     |
| D-MIGRATE | DB Migration 安全性    | Grep + ET    | Migration 順序依賴；partial run 冪等性；WAL mode 互動         |
| D-AUTH    | 認證、授權與安全防線   | Grep + ET    | Role 變更 mid-session；CF Access token refresh timing         |
| D-EDGE    | 邊界條件與資源限制     | Grep + ET    | CJK surrogate pairs；500+ items；無 frontmatter 的 vault 檔案 |
| D-TYPE    | TypeScript 型別安全    | Grep + ET    | API response shape drift；SQLite column type coercion         |
| D-PERF    | 效能問題               | Grep + ET    | N+1 隱藏在小資料集；FTS5 CJK trigram 大量資料；cache 風暴     |
| D-DEPLOY  | Build/Deploy 一致性    | ET 為主      | Vite dev vs prod 差異；Cloudflare Tunnel 重啟順序             |
| D-RACE    | 競態條件與並發問題     | ET 為主      | auto-save debounce 碰撞；vault watcher 與 export 並發         |

> **「ET 為主」** 表示該類別的核心缺陷本質上難以用 grep 偵測，需要人類觀察系統行為。
> **「Grep + ET」** 表示 grep 能覆蓋結構化部分，ET 補充判斷性的部分。

---

## 觸發條件：何時執行 ET

### 主動觸發

1. **新功能區域** — 新模組或大幅重構後，grep pattern 尚未建立覆蓋
2. **事故後 (Post-Incident)** — 生產環境問題暴露的盲區，grep 未覆蓋的互動模式
3. **Taxonomy 老化** — 某類別的最後一次搜查距今 >60 天，charter seed 可能已過時

### 被動觸發

4. **搜查發現可疑但無法確認** — grep 命中可疑 pattern，但需要人類判斷才能確定是否為缺陷
5. **跨類別互動** — 單一類別搜查正常，但兩個類別的邊界（例如 D-STATE + D-RACE）可能有問題

---

## Pattern Promotion（模式升格）

ET 發現升格為 grep pattern 需同時滿足三個條件：

1. **可重現** — 不是偶發現象，能穩定觸發
2. **可結構化** — 能構造 grep/搜查指令偵測類似案例
3. **信噪比可接受** — pattern 命中的結果中，真正問題的比例不會太低（目標 >30%）

### 升格流程

1. 在 ET session 回顧中標記候選 pattern
2. 在 codebase 上試跑，評估信噪比
3. 通過 → 加入對應類別的「搜查方式」section
4. 更新該類別的「探索測試種子」（移除已被 grep 覆蓋的方向，加入新浮現的負空間）

---

## Charter Seed 維護

Charter seed 不是靜態文件。每次 ET session 完成後：

1. **評估種子準確度** — 種子指向的方向有找到問題嗎？
2. **更新方向** — 移除已被驗證為安全的方向，加入意外發現暗示的新方向
3. **同步 grep coverage** — 如果有 pattern 被升格，更新種子描述以反映新的負空間

---

## 成功指標

> 建立日期：2026-04-06。首次評估：建立後 3 個月。

| 指標                       | 目標                 | 評估方式                                              |
| -------------------------- | -------------------- | ----------------------------------------------------- |
| ET session 執行數量        | 3+ sessions / 3 個月 | `find quality/et-sessions/ -name "*.md" \| wc -l`     |
| ET 發現升格為 grep pattern | 2+ patterns / 3 個月 | defect-taxonomy.md 搜查方式 section 新增項目          |
| ET 發現建立的 Issue 數量   | 追蹤即可             | `gh issue list --label "discovery-method:et-session"` |
| Charter seed 更新頻率      | 每次 session 後      | git log 追蹤 defect-taxonomy.md 的 charter seed 變更  |

---

## ET Session 記錄

ET session 記錄存放在 `quality/et-sessions/`，使用 `quality/et-charter-template.md` 模板。

**注意：** ET session 記錄是過程文件（探索日誌），不是品質項目（缺陷/債務/缺口）。如果 ET session 發現了缺陷，該缺陷建立為 GitHub Issue 並標記 `discovery-method:et-session` label。Session 記錄本身留在檔案系統中。

命名慣例：`YYYY-MM-DD-D-XXX-主題.md`（例如 `2026-04-10-D-STATE-cache-coherence.md`）
