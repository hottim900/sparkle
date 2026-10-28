# 安全更新與 Node runtime

## 2026-10-28 建置依賴緩解

`deepmerge` 的 [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
影響 4.2.0–4.3.1，截至本次檢查尚無上游修補版。根目錄 npm audit 的 4 個 low 項目
來自同一條 `vite-plugin-pwa → workbox-build → @rollup/plugin-node-resolve → deepmerge`
建置依賴鏈；MCP 與 `npm audit --omit=dev` 均無告警。

目前 `@rollup/plugin-node-resolve` 只用 deepmerge 複製套件內靜態 defaults，
未發現筆記內容或 API 輸入進入這次公告的合併路徑。這是本專案的可達性判斷，並非上游已修補。

`npm run build` 現在透過 Node `--disable-proto=throw` 啟動 Vite，阻擋公告中的
`__proto__` 原型寫入；遇到該路徑會中止建置。CI、部署與 Docker 都使用同一個 build script。
Regression tests 透過實際 npm build 入口驗證 target/source 的原型注入被攔截，以及普通巢狀合併仍可運作；
完整 PWA 建置另行驗證相容性。

這是緩解措施，完整 audit 仍保留 4 個 low 項目；不得宣稱零告警，也不要套用會降級 PWA 工具鏈的
`npm audit fix --force`。上游發布修補後，重新評估依賴更新並驗證建置與 E2E，再決定是否移除防護。

## 2026-10-27 修補

Sparkle 與 MCP server 必須使用 Node 22.23.4 或更新的 22.x 版本。
`.nvmrc`、npm engines、Docker 與 CI 指向修補版本；部署工作也從 `.nvmrc` 選擇 Node。
systemd 的 `ExecStart` 是絕對路徑，安裝新 Node 或修改 `.nvmrc` 不會更新正在執行的服務。

安裝依賴與建置後，在部署機器執行：

```bash
nvm install
nvm use
nvm alias default "$(cat .nvmrc)"
sudo bash scripts/upgrade-node-runtime.sh "$(command -v node)"
```

`nvm alias default` 適用於新 shell 的預設版本；繼承舊 Node PATH 的 shell 仍需執行 `nvm use`，
也可在登入／互動 shell 初始化時依目前專案 `.nvmrc` 選版，沒有專案設定時才選 default。

可先加 `--dry-run` 預覽。腳本只新增兩個服務的 `90-node-runtime.conf` drop-in，
保留原有防火牆、記憶體限制與 migration halt 設定，再重載 systemd、重啟服務並檢查狀態。
若已有同名 override，會先保存 `.bak`。升級後核對：

```bash
systemctl show sparkle sparkle-mcp-http --property=ExecStart
curl --fail http://localhost:3000/api/health
```

## MCP 請求限制

- 不接受壓縮的 JSON 或 OAuth 表單，回應 HTTP 415；避免在認證前建立 Brotli/zlib decoder。
- JSON 本文限制 1 MiB；OAuth 表單限制 16 KiB 與 32 個參數。
- 每次工具呼叫最多包含 10,000 個陣列元素與物件欄位，在 schema 驗證前拒絕超額輸入。
- Token 的 audience 固定為 `${MCP_ISSUER_URL}/mcp`，簽發與驗證都檢查該資源。
  舊 token 若沒有正確 audience，需重新授權連線。
- CI 分別掃描根目錄與 `mcp-server/` 的 lockfile，high 以上告警會阻擋合併。

## 原生 SQLite 與主機元件

`better-sqlite3` 12.11.1 內含 SQLite 3.53.2，修正 WAL-reset 資料損毀競態，
以及 CVE-2026-11822 / CVE-2026-11824 的 FTS5 問題。先前的 12.6.2 內含 3.51.2；
這些原生程式庫問題不會完整反映在 npm audit。Sparkle 沒有提供任意 SQL，
也沒有停用 defensive mode，因此未確認 FTS5 CVE 的利用前提成立；仍更新原生引擎。

安裝依賴後執行 `npm run security:native`，檢查實際載入的 SQLite 至少為 3.53.2。
CI 與部署在重啟服務前都會執行此檢查。升級前以 SQLite backup API 保存一致的資料庫備份，
升級後驗證備份完整性、FTS 搜尋與服務健康狀態；本次不變更 schema。

主機的 cloudflared、Brotli、zlib、NSS 與 Poppler 必須另外維護：

- cloudflared 更新至官方 2026.10.4（Go 1.27.3），下載時比對官方 release asset 的 SHA-256，
  再以 `govulncheck -mode=binary` 掃描。更新執行檔後，必須重啟所有共用該檔案的 tunnel；
  只替換路徑不會更新已執行中的 Go runtime。此主機的 Sparkle 與 LAN Share tunnel 共用執行檔。
- Ubuntu 24.04 安全更新至少包含 `libbrotli1` 1.1.0-2ubuntu0.1、
  `zlib1g` 1:1.3.dfsg-3.1ubuntu2.3、`libnss3` 2:3.98-1ubuntu0.3，
  以及 `libpoppler134` / `poppler-utils` 24.02.0-1ubuntu9.11。
  本次一併更新 `distro-info-data`；套件更新後檢查是否有使用舊函式庫、需要重啟的程序。

公告依據：[SQLite CVE](https://sqlite.org/cves.html)、
[WAL-reset 修正](https://sqlite.org/wal.html#walresetbug)、
[cloudflared 2026.10.4](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.4)、
[Ubuntu Brotli USN-8956-1](https://ubuntu.com/security/notices/USN-8956-1)、
[Ubuntu zlib USN-8954-1](https://ubuntu.com/security/notices/USN-8954-1)。

## 對應公告

- [Node CVE-2026-111497：Brotli decoder 記憶體破壞](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)。Node 22.23.4 同時包含先前漏掉的安全修補。
- [body-parser CVE-2026-111181：壓縮本文尾端資料導致程序當機](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828)。修補版為 2.4.0。
- [MCP SDK CVE-2026-111768：輸入驗證耗盡記憶體](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453)。升級 SDK 並啟用 `maxToolInputElements`。
- [MCP SDK CVE-2026-111771：token audience 驗證](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-rvq5-wwqv-78pq)。升級 SDK 並啟用 `expectedResource`，簽發新 token 時也固定 audience。
- [Zod CVE-2023-54404：集合驗證記憶體耗用](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。修補版為 4.6.6。
