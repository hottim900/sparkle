# 缺陷分類學 — 系統性搜查手冊

> **用途：** 定義已知和潛在的缺陷類別，提供可重複執行的搜查模式，讓開發者能快速找出同類問題。
> 每個類別附帶搜查指令、已知實例、和判定標準。

**建立日期：** 2026-03-04
**最後更新：** 2026-03-22

> 舊系統項目參考：https://github.com/hottim900/sparkle-quality

### 搜查結果記錄格式

每個類別搜查完畢後，用以下三層結構記錄結果：

1. **發現（建 Issue）** — 確認的缺陷，已建立追蹤 Issue。格式：`DEF-NNN（Issue #N）— 描述`
2. **Low-risk observations（不建 Issue）** — 可疑但影響太低，不值得正式追蹤。記錄檔案位置和原因，供未來參考。
3. **審查但判定合理（非缺陷）** — 經審查排除的項目。記錄判定理由，避免下次重複審查。

---

## 分類總覽

| 代號      | 缺陷類別                | 層級              | 已知實例                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 搜查狀態      |
| --------- | ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D-SILENT  | 靜默失敗與可觀測性缺口  | 全層              | DEF-001, DEF-011, DEF-012, DEF-018, DEF-019, DEF-022, DEF-025, DEF-026, TD-026 | ✅ 2026-03-20 |
| D-VALID   | 輸入驗證缺口            | API               | DEF-003, DEF-004, DEF-005, DEF-013, DEF-021, DEF-025                                                                                                                                                                                                          | ✅ 2026-03-20 |
| D-STATE   | 前端狀態管理不一致      | Frontend          | DEF-002, DEF-015, DEF-016                                                                                                                                                                                                                                                                                                                                                                          | ✅ 2026-03-20 |
| D-OFFLINE | 離線同步與 PWA 問題     | Frontend / SW     | (DEF-001)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ 2026-03-20 |
| D-QUERY   | 查詢語意錯誤            | Server            | DEF-010                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 2026-03-20 |
| D-MIGRATE | DB Migration 安全性     | Server            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 2026-03-20 |
| D-AUTH    | 認證、授權與安全防線    | API / 全層        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 2026-03-20 |
| D-EDGE    | 邊界條件與資源限制      | 全層              | DEF-006, DEF-007                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ 2026-03-20 |
| D-TYPE    | TypeScript 型別安全漏洞 | Frontend / Server | DEF-008, TD-001, TD-004, TD-005, TD-006                                                                                                                                                                                                                                                                  | ✅ 2026-03-20 |
| D-PERF    | 效能問題                | 全層              | DEF-009, DEF-014, TD-002, TD-003, FG-001                                                                                                                                                                                                                                                                                            | ✅ 2026-03-20 |
| D-DEPLOY  | Build/Deploy 一致性     | DevOps            | TD-027                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ 2026-03-20 |
| D-RACE    | 競態條件與並發問題      | Frontend / Server | DEF-024                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 2026-03-20 |

---

## D-SILENT: 靜默失敗與可觀測性缺口

### 定義

兩個子面向：

1. **錯誤吞沒** — catch 塊中只記錄 log 或完全忽略錯誤，上層不知道操作失敗。包含 API 錯誤未正確傳遞給 UI、Service Worker 中的錯誤吞沒等。
2. **可觀測性缺口** — 應該被記錄但沒有記錄的操作。包含缺少 audit trail 的破壞性操作（批次刪除、匯出）、前端用 `console.*` 而非結構化 logger、Sentry 整合缺口。

### 搜查方式

```bash
# === 錯誤吞沒（原有） ===

# 精準搜查：bare catch（空 catch 或只有註解的 catch）— 最高信噪比
grep -n "catch.*{" server/ src/ --include="*.ts" --include="*.tsx" -A 2 | grep -B 1 "^\s*}"

# 次精準：catch 後沒有 throw/toast/log 的地方
grep -n "catch" server/ src/ --include="*.ts" --include="*.tsx" -A 5 | grep -v "throw\|toast\|log\|warn\|error\|reject"

# 廣域搜查（噪音高，~70 筆）：所有 catch — 只在首次全面盤點時用
grep -rn "catch" server/ src/ --include="*.ts" --include="*.tsx"

# HTTP response 未檢查 status（fetch 後沒有 ok/status 檢查）
grep -n "await fetch" server/ src/ --include="*.ts" --include="*.tsx" -A 3 | grep -v "\.ok\|\.status\|response\.ok"

# === 可觀測性缺口（新增） ===

# 前端 console.* 應改用結構化 logger 或移除
grep -rn "console\." src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.test\."

# 破壞性操作（delete、batch）缺少 server-side logger
grep -rn "delete\|batch" server/routes/ --include="*.ts" -A 5 | grep -v "logger\."

# Sentry captureException 覆蓋範圍
grep -rn "captureException\|captureMessage" server/ src/ --include="*.ts" --include="*.tsx"
```

> **搜查策略：** 錯誤吞沒從精準到廣域。可觀測性先查 console.\* 和缺 logger 的破壞性路由。

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**範圍：** `server/` + `src/` 全部 `.ts/.tsx`（排除測試檔），共檢查 ~70 個 catch 區塊。

**發現：**

- DEF-001 — `src/sw.ts` replayQueue 未檢查 HTTP response status，4xx/5xx 時靜默刪除離線佇列項目（Medium / S2-Major）
- DEF-011 — `server/routes/search.ts` catch 塊無 logger.error，搜尋失敗被吞沒（High / S2-Major）
- DEF-012 — `server/routes/webhook.ts` LINE 搜尋 bare catch，無日誌記錄（High / S2-Major）
- DEF-026 — `mcp-server/src/vault.ts` writeVaultFileBySparkleId 寫入不驗證 frontmatter，sparkle_id 追蹤靜默斷裂（High / S2-Major）— 已修復 PR #167
- `server/db/index.ts:268,362` — 多餘的 bare catch 包裹 `IF NOT EXISTS` 語句，可能吞掉非預期 SQLite 錯誤（Low，未建 DEF）
- TD-026 — `mcp-server/src/http.ts` 15 處 console.\* 代替結構化 logger，繞過 Sentry 和結構化日誌（Medium）（2026-03-20 增量發現）

**審查但判定合理（非缺陷）：**

- Server 端 JSON.parse catch → 均有 `logger.warn` + HTTP 4xx 回應
- Frontend catch → 均有 `toast.error` 通知使用者
- Health check catch → 設定 degraded 狀態（設計如此）
- SW offline queue catch → 正確的離線佇列排隊模式

---

## D-VALID: 輸入驗證缺口

### 定義

API endpoint 的 Zod schema 未覆蓋所有輸入欄位，或驗證規則不完整（缺少長度限制、格式檢查等）。

### 搜查方式

```bash
# 列出所有 route handler
grep -rn "app\.\(get\|post\|put\|patch\|delete\)" server/routes/ --include="*.ts"

# 列出所有 Zod schema
grep -rn "z\.object" server/ --include="*.ts"

# 對比：每個寫入端點是否有對應的 Zod 驗證
```

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**範圍：** 18 個 API endpoint、7 個 Zod schema。

**發現：**

- DEF-003 — Import endpoint 5 處驗證缺口（id 非 UUID、type 缺 scratch、content 無 max、tags/aliases 無 JSON 驗證、items 無上限）
- DEF-004 — 搜尋 q 無 max、tag 無 min/max
- DEF-005 — LINE !tag 繞過 Zod max(20) 限制
- DEF-013 — Short ID prefix lookup 無 max 長度驗證、LIKE 查詢缺 ORDER BY（High / S2-Major）

**審查但判定合理：** 路徑參數 :id 未顯式驗證但由 DB lookup 保護、FTS5 轉義正確。

---

## D-STATE: 前端狀態管理不一致

### 定義

React Query cache 未正確 invalidate、樂觀更新與伺服器狀態不一致、多個元件的狀態同步問題。

### 搜查方式

```bash
# 列出所有 useMutation 的 onSuccess/onSettled
grep -A 5 "useMutation" src/ --include="*.ts" --include="*.tsx" -r

# 檢查 invalidateQueries 的覆蓋範圍
grep -rn "invalidateQueries\|invalidate" src/ --include="*.ts" --include="*.tsx"

# 找出直接操作 state 而非透過 React Query 的地方
grep -rn "setState\|setItems\|setNotes" src/ --include="*.ts" --include="*.tsx"
```

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**範圍：** TanStack Router 遷移後全面重掃，含 route 元件、ErrorBoundary、invalidation 模式、error/empty 狀態區分。

**發現：**

- DEF-002 — LinkedItemsSection 3 處 invalidation 不完整
- DEF-015 — 大多數 list route 缺少 ErrorBoundary，元件 throw 時白屏（Medium / S3-Minor）
- DEF-016 — item-list 錯誤狀態與空列表共用同一 UI，toast 消失後不可區分（Low / S4-Trivial）

**Low-risk observations：** ShareDialog 使用本地 state 管理（非缺陷，設計合理）。refetchOnWindowFocus 部分元件停用（item-detail dirty check、fleeting-triage），不一致但各有合理原因。

**審查但判定合理：** QuickCapture/ItemDetail/FleetingTriage invalidation 策略一致、CategoryManagement 樂觀更新有完整 rollback。

---

## D-OFFLINE: 離線同步與 PWA 問題

### 定義

IndexedDB 離線佇列的同步失敗處理、Service Worker 快取策略不當、離線 → 上線恢復時的資料衝突。

### 搜查方式

```bash
# 離線佇列相關邏輯
grep -rn "offlineQueue\|indexedDB\|IDB" src/ --include="*.ts" --include="*.tsx"

# Service Worker 快取策略
grep -rn "NetworkFirst\|CacheFirst\|StaleWhileRevalidate" src/ --include="*.ts"

# 網路狀態偵測
grep -rn "navigator.onLine\|online\|offline" src/ --include="*.ts" --include="*.tsx"
```

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**發現：** 無新缺陷（DEF-001 已知）。

**Low-risk observations：** IndexedDB 佇列無大小限制檢查（實務低風險，配額 50-100MB）。

**審查但判定合理：** SW 快取策略（NetworkFirst + 10s timeout）、POST 離線佇列設計、online listener 設計均合理。

---

## D-QUERY: 查詢語意錯誤

### 定義

SQL 查詢能正確執行但語意不對：排序不確定、FTS5 搜尋行為異常、分頁遺漏、JOIN 條件不完整。

### 搜查方式

```bash
# Drizzle ORM 查詢
grep -rn "db\.\(select\|insert\|update\|delete\)" server/ --include="*.ts"

# 原生 SQL 查詢
grep -rn "db\.prepare\|\.run(\|\.get(\|\.all(" server/ --include="*.ts"

# LIMIT 無 ORDER BY
grep -B 5 "\.limit(" server/ --include="*.ts"

# FTS5 搜尋查詢
grep -rn "fts\|MATCH" server/ --include="*.ts"
```

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**發現：**

- DEF-010 — `listItems()` tag filter 路徑使用 `sql.raw(sortField)` 繞過參數化查詢，違反防禦縱深（High / S2-Major）
- DEF-020 — `shares.ts` 兩處使用 `SELECT *`，回傳多餘欄位。已修復為明確欄位列表。（Low / S4-Trivial）✅ Done

**審查但判定合理：** FTS5 外部內容表正確、GROUP BY + LEFT JOIN 安全、統計 CASE WHEN 邏輯正確、short ID prefix LIKE 查詢使用 Drizzle `like()` 安全函式。

---

## D-MIGRATE: DB Migration 安全性

### 定義

SQLite migration 中的不安全操作：`SELECT *` 在 INSERT 中（欄位順序依賴）、缺少 foreign_keys OFF 的 DROP TABLE、transaction 內的 schema version 設定。

### 搜查方式

```bash
# Migration 相關程式碼（已有 PostToolUse hook 保護）
grep -n "SELECT \*" server/db/index.ts
grep -n "DROP TABLE" server/db/index.ts
grep -n "setSchemaVersion" server/db/index.ts
```

> **注意：** 已有 `.claude/hooks/migration-safety.sh` PostToolUse hook 做自動檢查。此分類主要用於回顧性搜查。

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**發現：** 無缺陷。Migration v0-13 均使用明確列列表（無 SELECT \*）、FK 管理正確、setSchemaVersion 在 transaction 外、idempotent 保護完整。

---

## D-AUTH: 認證、授權與安全防線

### 定義

三個子面向：

1. **認證與授權** — Bearer token 驗證遺漏、API 端點未正確保護、公開路由暴露過多資訊。
2. **Secret 儲存與傳輸** — auth token 在 localStorage/MessageChannel 的安全性、.env 中的 secret 管理、logout 時 token 清除。
3. **內容注入防線** — CSP header 完整性、markdown 渲染 XSS 防護、dangerouslySetInnerHTML 使用。

### 搜查方式

```bash
# === 認證與授權（原有） ===

# 所有 API 路由
grep -rn "app\.\(get\|post\|put\|patch\|delete\)" server/routes/ --include="*.ts"

# 認證中介層
grep -rn "authMiddleware\|bearerAuth\|Authorization" server/ --include="*.ts"

# 公開路由（不需認證）
grep -rn "/api/public\|/api/webhook\|/api/health" server/ --include="*.ts"

# === Secret 儲存與傳輸（新增） ===

# localStorage / sessionStorage 中的 token
grep -rn "localStorage\|sessionStorage" src/ --include="*.ts" --include="*.tsx"

# Service Worker token 傳遞
grep -rn "postMessage\|MessageChannel" src/ --include="*.ts" --include="*.tsx" -A 3

# === 內容注入防線（新增） ===

# CSP header 定義
grep -rn "Content-Security-Policy" server/ --include="*.ts"

# dangerouslySetInnerHTML（應為 0）
grep -rn "dangerouslySetInnerHTML\|innerHTML" src/ --include="*.tsx"

# eval / Function constructor（應為 0）
grep -rn "eval(\|new Function(" src/ server/ --include="*.ts" --include="*.tsx"
```

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**範圍：** 認證、secret 儲存、CSP/XSS 全面搜查。

**發現：** 無缺陷。

**認證與授權：** Bearer token timing-safe 比較正確、全域 authMiddleware 覆蓋所有 /api/\* 路由、公開路由正確過濾 visibility、LINE webhook HMAC-SHA256 驗證正確。

**Secret 儲存：** localStorage auth_token 是 SPA 標準做法（CF Access 已在前端保護）。SW token 透過 MessageChannel 安全傳遞（非 localStorage 暴露）。.env 正確 gitignored。

**內容注入：** CSP `script-src 'self'` 阻擋 inline script。`style-src 'unsafe-inline'` 為 Tailwind 所需。無 dangerouslySetInnerHTML、無 eval。react-markdown 安全渲染（不執行 HTML）。

---

## D-EDGE: 邊界條件與資源限制

### 定義

未處理的極端輸入：超長標題、空內容、超大 tags 陣列、分頁 offset 負數、同時操作同一筆記錄。

### 搜查方式

```bash
# Zod schema 的 max/min 限制
grep -rn "z\.string()\.\(max\|min\)" server/ --include="*.ts"

# 分頁參數驗證
grep -rn "offset\|limit\|page" server/routes/ --include="*.ts"

# 陣列長度限制
grep -rn "z\.array" server/ --include="*.ts"
```

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**發現：**

- DEF-006 — color 無格式驗證、reorder items 無 max、sort_order 無 max
- DEF-007 — batch ids 陣列無 max 上限
- DEF-023 — export collision timestamp 只到分鐘精度，同分鐘內重複 export 會覆蓋。已修復為秒精度。（Low / S4-Trivial）✅ Done

**Low-risk observations：** offset 允許任意大整數（SQLite 自動處理）、並發寫入（WAL 模式序列化）。

**審查但判定合理：** origin/source max 已設、tags/aliases 上限已設、空 content 按設計允許。

---

## D-TYPE: TypeScript 型別安全漏洞

### 定義

`as any` 強制轉型、不安全的類型斷言、API 回傳值與前端型別定義不一致。

### 搜查方式

```bash
# any 使用
grep -rn "as any\|: any" src/ server/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "*.test.*"

# 型別斷言
grep -rn "as [A-Z]" src/ server/ --include="*.ts" --include="*.tsx" | grep -v "as const"

# API 回傳型別
grep -rn "interface.*Response\|type.*Response" src/ --include="*.ts"
```

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**範圍：** TanStack Router 遷移後全面重掃，含 navigation `as any`、search param 型別、Query invalidation 模式、dependency 漏洞。

**發現：**

- DEF-008 — parseItem JSON.parse 無 try-catch，前端崩潰風險
- TD-001 — 多處 `as` 斷言掩蓋型別驗證（items.ts, shares.ts, webhook.ts）
- TD-004 — Router search params 多處 `as any` / `as NavigateOptions` 繞過型別安全（Medium / S3-Minor）
- TD-005 — React Query 每次 mutation 都 invalidate `items.all`，導致 cascade refetch（Medium / S3-Minor）
- TD-006 — Hono 4.7.4 prototype pollution 漏洞，需升級至 >= 4.12.7（Medium / S3-Minor）

**Low-risk observations：** 前後端型別定義有潛在偏差但 JSON 序列化自動處理。`routeTree.gen.ts` 自動產生的 `as any` 不需處理。gcTime 未顯式設定（使用預設 5 分鐘，可接受）。

**審查但判定合理：** Item tags/aliases 為 string（配合 parseItem 轉換）、ShareTokenRow 分離設計清晰。Server 端 error handling、auth middleware、rate limiting、input validation 全部通過。

---

## D-PERF: 效能問題

### 定義

不必要的 re-render、缺少 memo/useMemo、N+1 查詢、大量資料未分頁、bundle size 過大。

### 搜查方式

```bash
# React 元件是否使用 memo
grep -rn "React\.memo\|memo(" src/ --include="*.tsx"

# useMemo/useCallback 使用
grep -rn "useMemo\|useCallback" src/ --include="*.tsx"

# 資料庫查詢是否有 LIMIT
grep -rn "\.all(" server/ --include="*.ts" | grep -v "LIMIT\|limit"
```

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**範圍：** Router 遷移後重掃，含 accessibility、bundle size、re-render 模式。

**發現：**

- DEF-009 — /api/export 無 LIMIT，大量資料 OOM 風險
- DEF-014 — listShares / listPublicShares 查詢無 LIMIT（High / S2-Major）
- TD-002 — React Query staleTime=0 過度重查
- TD-003 — ~~Batch 操作 N+1 查詢，1000 IDs 最壞 5000+ 查詢~~ ✅ Done（PR #102，改為 bulk SQL）
- FG-001 — 多數 icon-only buttons 缺少 aria-label，螢幕閱讀器無法辨識（Medium）

**Low-risk observations：** export 無欄位篩選（帶寬可優化）、ItemList 分組 O(n) 已用 useMemo。inline query options 在 linked-items-section（React Query 內部處理 memoization，實際影響低）。

**審查但判定合理：** DB 索引完整覆蓋、前端陣列大小合理。item-list.tsx useMemo 覆蓋良好。bundle size 合理（42 precache entries，code splitting via TanStack Router）。

---

## D-DEPLOY: Build/Deploy 一致性

### 定義

Source code 與 deployed artifact 的不一致。包含：

- **Build artifact 過期** — `dist/` 目錄未重新 build，缺少新增的模組（如 MCP server categories tools）
- **Config drift** — .env / .env.example 不同步、systemd service 設定與 code 不匹配、Cloudflare tunnel config 過期
- **版本標籤** — package.json version 未更新、deploy 後未驗證

### 搜查方式

```bash
# === Build artifact 一致性 ===

# MCP server: source vs dist 模組對比
diff <(ls mcp-server/src/tools/*.ts 2>/dev/null | xargs -I{} basename {} .ts | sort) \
     <(ls mcp-server/dist/tools/*.js 2>/dev/null | xargs -I{} basename {} .js | sort)

# MCP server: dist/index.js imports vs src/index.ts imports
grep "import.*from" mcp-server/dist/index.js | sort
grep "import.*from" mcp-server/src/index.ts | sort

# Frontend: dist/ 是否存在且非空
ls -la dist/index.html 2>/dev/null

# === Config drift ===

# .env.example vs 實際使用的 env vars 對比
grep -rn "process\.env\." server/ --include="*.ts" | grep -oP "process\.env\.\w+" | sort -u
cat .env.example 2>/dev/null | grep -v "^#" | grep "=" | cut -d= -f1 | sort

# systemd service 檔案引用的路徑是否存在
grep -r "ExecStart\|WorkingDirectory\|Environment" /etc/systemd/system/sparkle* 2>/dev/null

# === 版本一致性 ===

# package.json version vs git tag
grep '"version"' package.json
git tag --sort=-v:refname | head -5
```

> **搜查策略：** diff source vs artifact 是最高效的搜查。config drift 需要 cross-reference .env.example 和 process.env 使用處。

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**範圍：** MCP server source vs dist、.env.example vs process.env 使用處、systemd service 路徑、package.json version vs git tag。

**發現：**

- TD-027 — MCP server version 硬編碼 `"1.0.0"`（`mcp-server/src/server.ts:15`），主程式已 `1.1.1`。`mcp-server/package.json` 也停在 `1.0.0`。（Low / S4-Trivial）

**Low-risk observations：**

- `SPARKLE_API_URL` 和 `RATE_LIMIT_MAX` 在程式碼中使用但未記載於 `.env.example`。兩者皆有合理 fallback（localhost:3000、200 req/min），低風險。
- MCP dist 與 source 同步（8 tool modules 皆正確編譯），deploy workflow 正確處理 build。

**審查但判定合理：**

- SystemD service paths 全部存在且正確（sparkle.service、sparkle-mcp-http.service）。
- Frontend `dist/index.html` 存在且完整（PWA manifest、SW、icons）。
- `dist/` 正確 gitignored，deploy workflow 在 restart 前 rebuild。

---

## D-RACE: 競態條件與並發問題

### 定義

前端或後端的並發操作導致非預期行為。包含：

- **Double-submit** — mutation 按鈕未在 pending 時 disable，使用者快速雙擊送出兩次
- **Stale closure** — useCallback/useEffect 的 dependency 不完整，callback 捕獲過期的 state
- **Abort race** — AbortController timeout 與 response 到達的競爭、unmount 後的 state update
- **Server-side 並發** — 同一筆記的並行寫入（SQLite WAL 序列化，低風險但仍需確認 optimistic update 一致性）

### 搜查方式

```bash
# === Double-submit ===

# mutation 按鈕是否有 disabled={isPending} 保護
grep -rn "mutateAsync\|mutate(" src/ --include="*.tsx" -B 10 | grep -v "disabled"

# useMutation 的 isPending 是否被使用
grep -rn "useMutation" src/ --include="*.ts" --include="*.tsx" -A 3

# === Stale closure ===

# useCallback 的 dependency array 是否完整（需人工審查）
grep -rn "useCallback" src/ --include="*.ts" --include="*.tsx" -A 1

# useEffect cleanup 是否有 return（非同步 effect 需要 cleanup）
grep -rn "useEffect.*async\|useEffect.*fetch\|useEffect.*await" src/ --include="*.ts" --include="*.tsx"

# === Abort race ===

# AbortController 使用與 cleanup
grep -rn "AbortController\|abort()" src/ --include="*.ts" --include="*.tsx"

# unmount 後的 setState（cancelled flag pattern）
grep -rn "cancelled\|isMounted\|aborted" src/ --include="*.ts" --include="*.tsx"

# === 前端 debounce cleanup ===

# setTimeout 是否有對應的 clearTimeout
grep -rn "setTimeout" src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

> **搜查策略：** Double-submit 最容易 grep，stale closure 需要人工審查 dependency array。abort race 檢查 AbortController 與 cleanup 配對。

**搜查狀態：** ✅ 已搜查（2026-03-20）

### 搜查結果

**範圍：** 全部 `src/` `.tsx/.ts` 的 useMutation、useCallback、useEffect、setTimeout、AbortController，以及 `server/` 的 transaction 使用。

**發現：**

- DEF-024 — CategoryManagement 4 個 mutation（create、update、reorder、delete）按鈕均缺 `isPending` 保護，使用者快速雙擊可觸發重複操作。（Medium / S3-Minor）

**Low-risk observations：**

- `CategorySelect.handleCreateSubmit`（`category-select.tsx:59`）無 isPending 保護，但觸發點為 Enter key，重複風險低。
- `TagInput` blur setTimeout 200ms 無 cleanup（`tag-input.tsx:105`），unmount 後可能 setState，但 React 容忍此行為且僅影響 UI state。
- Batch export 無 transaction 包裹 read-then-write（`items.ts:94-149`），但 export 為冪等操作且罕見使用，風險低。

**審查但判定合理：**

- **Double-submit 保護完善的元件：** QuickCapture（`isPending` guard + disabled）、ShareDialog（`creating/revokingId` state + disabled）、FleetingTriage（single-item workflow 限制並發）。
- **Stale closure 防護：** useItemForm（ref-based debounce + cleanup）、SearchBar（debounceRef + cleanup）、LinkedItemsSection（noteSearchTimeoutRef + cleanup）、Settings（`cancelled` flag pattern）。
- **Abort race：** `api.ts` AbortController + clearTimeout 配對正確。
- **Server-side 並發：** Category create/reorder 皆用 `db.transaction()` 保護。Optimistic update（category reorder）有完整 rollback。

---

## 搜查執行紀錄

| 日期       | 搜查範圍                                       | 結果                                                                                                           |
| ---------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 2026-03-04 | D-SILENT（全層 catch 區塊）                    | 1 defect (DEF-001), 1 low-risk observation                                                                     |
| 2026-03-06 | D-VALID（API 輸入驗證）                        | 3 defects (DEF-003, DEF-004, DEF-005)                                                                          |
| 2026-03-06 | D-STATE（React Query invalidation）            | 1 defect (DEF-002)                                                                                             |
| 2026-03-06 | D-OFFLINE（離線同步）                          | 0 new defects                                                                                                  |
| 2026-03-06 | D-QUERY（查詢語意）                            | 0 defects                                                                                                      |
| 2026-03-06 | D-MIGRATE（Migration 安全性）                  | 0 defects                                                                                                      |
| 2026-03-06 | D-AUTH（認證授權）                             | 0 defects                                                                                                      |
| 2026-03-06 | D-EDGE（邊界條件）                             | 2 defects (DEF-006, DEF-007)                                                                                   |
| 2026-03-06 | D-TYPE（型別安全）                             | 1 defect (DEF-008), 1 tech debt (TD-001)                                                                       |
| 2026-03-06 | D-PERF（效能）                                 | 1 defect (DEF-009), 1 tech debt (TD-002)                                                                       |
| 2026-03-08 | 全 10 類別增量搜查                             | 5 new defects (DEF-010~014), 1 tech debt (TD-003)                                                              |
| 2026-03-13 | Router 遷移後全面架構搜查                      | 2 defects (DEF-015, DEF-016), 3 tech debt (TD-004~006), 1 feature gap (FG-001)                                 |
| 2026-03-13 | AI 開發效率與成功率專題搜查                    | 4 tech debt (TD-007~010), 2 feature gaps (FG-002, FG-003)                                                      |
| 2026-03-17 | 重構後全 10 類別增量搜查                       | 0 new defects — 重構品質良好，error handling/validation/invalidation 均正確維持                                |
| 2026-03-17 | 新增 D-DEPLOY + D-RACE，擴充 D-SILENT + D-AUTH | 分類 10→12，D-SILENT 加入可觀測性，D-AUTH 加入 secret/CSP                                                      |
| 2026-03-20 | 全 12 類別完整搜查（含 D-DEPLOY/D-RACE 首次）  | 1 defect (DEF-024), 2 tech debt (TD-026, TD-027); MCP HTTP transport + vault tools 增量掃描通過; FG-004 已完成 |

---

## 下次搜查建議

全 12 類別搜查完成（2026-03-20）。

1. **新 PR 合併後** — 針對變更檔案涉及的類別做增量搜查
2. **季度全面搜查** — 重跑所有類別，比對上次結果（下次：2026-06）
3. **MCP HTTP server 持續關注** — 新功能快速迭代中，D-SILENT（console.\*）、D-VALID（schema 邊界）、D-AUTH（token 管理）需隨新 PR 增量掃描
