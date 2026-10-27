# 安全更新與 Node runtime

## 2026-10-27 修補

Sparkle 與 MCP server 必須使用 Node 22.23.4 或更新的 22.x 版本。
`.nvmrc`、npm engines、Docker 與 CI 指向修補版本；部署工作也從 `.nvmrc` 選擇 Node。
systemd 的 `ExecStart` 是絕對路徑，安裝新 Node 或修改 `.nvmrc` 不會更新正在執行的服務。

安裝依賴與建置後，在部署機器執行：

```bash
nvm install
nvm use
sudo bash scripts/upgrade-node-runtime.sh "$(command -v node)"
```

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

## 對應公告

- [Node CVE-2026-111497：Brotli decoder 記憶體破壞](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)。Node 22.23.4 同時包含先前漏掉的安全修補。
- [body-parser CVE-2026-111181：壓縮本文尾端資料導致程序當機](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828)。修補版為 2.4.0。
- [MCP SDK CVE-2026-111768：輸入驗證耗盡記憶體](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453)。升級 SDK 並啟用 `maxToolInputElements`。
- [MCP SDK CVE-2026-111771：token audience 驗證](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-rvq5-wwqv-78pq)。升級 SDK 並啟用 `expectedResource`，簽發新 token 時也固定 audience。
- [Zod CVE-2023-54404：集合驗證記憶體耗用](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。修補版為 4.6.6。
