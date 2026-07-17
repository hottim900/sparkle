# Cloudflare Access 設定指南

本指南說明如何使用 Cloudflare Access 保護 Sparkle，讓你可以安全地從任何地方存取你的筆記系統，同時保持 LINE Bot webhook 正常運作。

## 目錄

1. [前置條件](#前置條件)
2. [啟用 Zero Trust 免費方案](#啟用-zero-trust-免費方案)
3. [設定身份驗證方式](#設定身份驗證方式)
4. [便利性設定：GitHub 登入 + 較長 Session](#便利性設定github-登入--較長-session)
5. [建立 Access Policy](#建立-access-policy)
6. [建立 Access Application](#建立-access-application)
7. [建立 Bypass Applications](#建立-bypass-applications)
8. [驗證](#驗證)
9. [Service Token（程式化存取）](#service-token程式化存取)
10. [常見問題](#常見問題)

---

## 前置條件

在開始之前，請確認以下項目已備妥：

- **Cloudflare 帳號** — 在 [cloudflare.com](https://www.cloudflare.com/) 註冊免費帳號即可
- **Domain 已加入 Cloudflare DNS** — 你的網域必須已經在 Cloudflare 管理 DNS
- **Cloudflare Tunnel 已設定完成** — 已執行 `scripts/setup-cloudflared.sh` 或手動設定好 Tunnel，且 Tunnel 正在運行中
- **Sparkle 服務正常運行** — 可透過 `sudo systemctl status sparkle` 確認

> **背景說明**：先前的 Cloudflare Tunnel 設定僅公開 `/api/webhook/*` 路徑，其餘路徑回傳 404。現在我們改為公開完整服務，並透過 Cloudflare Access 來控制存取權限。這讓你可以從任何地方安全地存取 Sparkle，而不需依賴 VPN。

---

## 啟用 Zero Trust 免費方案

Cloudflare Access 是 Cloudflare Zero Trust 平台的一部分，個人使用免費。

1. 前往 [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)

2. 如果是第一次使用，系統會要求你選擇一個 **team name**（例如 `my-sparkle`）。這會成為你的 Zero Trust 組織名稱，之後可以更改。

3. 選擇 **Free plan**（免費方案）
   - 最多支援 50 位使用者
   - 不需要信用卡
   - 包含 Access、Gateway 等基本功能

4. 完成初始設定後，你會看到 Zero Trust Dashboard 的主畫面。

---

## 設定身份驗證方式

Cloudflare Access 支援多種身份驗證方式（Identity Provider）。以下列出三種推薦選項，依簡易度排序。

### 選項 A：Email OTP（零設定）

這是最簡單的方式，完全不需要額外設定。

**運作方式**：存取 Sparkle 時，Cloudflare 會顯示登入頁面，你輸入 email 後，Cloudflare 寄送一組一次性驗證碼（OTP）到該 email，輸入驗證碼即可登入。

**設定步驟**：

1. 在 Zero Trust Dashboard 側邊欄，前往 **Settings > Authentication**
2. 在 **Login methods** 區塊，確認 **One-time PIN** 已啟用（預設就是啟用的）
3. 完成！不需要其他設定

> **適合情境**：第一次設定、想快速上線。日常使用若覺得驗證碼太頻繁，建議改用 GitHub 或 Google 登入並拉長 Session Duration。

### 選項 B：Google 登入

如果你習慣用 Google 帳號登入各種服務，這是很方便的選項。

**設定步驟**：

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) > APIs & Services > Credentials
2. 建立一個新的 **OAuth 2.0 Client ID**：
   - Application type：Web application
   - Authorized redirect URIs：加入 `https://<your-team-name>.cloudflareaccess.com/cdn-cgi/access/callback`
3. 記下 Client ID 和 Client Secret
4. 回到 Zero Trust Dashboard > Integrations > Identity providers（舊版 UI 可能在 Settings > Authentication > Login methods）
5. 點擊 **Add new** > **Google**
6. 填入 Client ID 和 Client Secret
7. 儲存

> **注意**：`<your-team-name>` 是你的 Cloudflare Zero Trust team name，不是 Sparkle hostname。若 team domain 是 `tim-home.cloudflareaccess.com`，team name 就是 `tim-home`。

### 選項 C：GitHub 登入

如果你是開發者且常用 GitHub，這也是不錯的選擇。

**設定步驟**：

1. 前往 [GitHub Developer Settings](https://github.com/settings/developers) > OAuth Apps > New OAuth App
2. 填寫資訊：
   - Application name：`Sparkle CF Access`（任意名稱）
   - Homepage URL：`https://<your-team-name>.cloudflareaccess.com`
   - Authorization callback URL：`https://<your-team-name>.cloudflareaccess.com/cdn-cgi/access/callback`
3. 記下 Client ID，並產生一組 Client Secret
4. 回到 Zero Trust Dashboard > Integrations > Identity providers（舊版 UI 可能在 Settings > Authentication > Login methods）
5. 點擊 **Add new** > **GitHub**
6. 填入 Client ID 和 Client Secret
7. 儲存後點擊 **Finish setup**，在 GitHub 授權 Cloudflare Access 讀取 email 與 organization/team 資訊
8. 回到 Identity providers 頁面，點擊 GitHub login method 旁的 **Test** 確認連線正常

> **注意**：GitHub OAuth 的 Homepage URL 和 callback URL 必須使用 `*.cloudflareaccess.com` 的 team domain，不要填 Sparkle 的公開網址（例如 `sparkle.example.com`）。

---

## 便利性設定：GitHub 登入 + 較長 Session

如果你的目標是減少 Email OTP 驗證碼，同時保留 Cloudflare Access 這層保護，建議使用這組設定：

- 登入方式：GitHub（或 Google）
- Global session duration：`1 month`
- Sparkle application session duration：`1 month`
- Sparkle policy session duration：`Same as application` 或 `1 month`
- Sparkle application 只啟用 GitHub login method，並開啟 instant authentication

### 1. 拉長全域 Session

1. 前往 Cloudflare Dashboard > **Zero Trust**
2. 前往 **Access controls > Access settings**
3. 找到 **Set your global session duration**，點擊 **Edit**
4. 設為 `1 month`
5. 儲存

### 2. 拉長 Sparkle Application Session

1. 前往 **Access controls > Applications**
2. 開啟 **Sparkle** application，點擊 **Configure**
3. 找到 **Session Duration**
4. 設為 `1 month`
5. 儲存

### 3. 檢查 Policy Session

Policy 的 session duration 會覆蓋 application duration，所以也要檢查：

1. 前往 **Access controls > Policies**
2. 開啟 Sparkle 使用的 allow policy（例如 `Allow owner`）
3. 找到 **Session Duration**
4. 設為 **Same as application** 或 `1 month`
5. 儲存

### 4. 讓 Sparkle 只用 GitHub 登入

1. 前往 **Access controls > Applications**
2. 開啟 **Sparkle** application，點擊 **Configure**
3. 前往 **Authentication**
4. 關閉 **Accept all available identity providers**（如果有啟用）
5. 只選擇 **GitHub**
6. 取消選擇 **One-time PIN / Email OTP**
7. 啟用 **Apply instant authentication**
8. 儲存

完成後，瀏覽器應該直接導向 GitHub，不再顯示 Email OTP 或 Cloudflare 的登入方式選擇頁。

### 5. 重新測試登入

先登出 Cloudflare Access：

```text
https://<your-sparkle-domain>/cdn-cgi/access/logout
```

再用無痕視窗開啟 Sparkle。預期流程：

1. 開啟 Sparkle URL
2. Cloudflare 直接導向 GitHub
3. GitHub 授權完成後回到 Sparkle
4. 如果該瀏覽器沒有 Sparkle 自己的 `AUTH_TOKEN`，Sparkle 仍會要求輸入一次存取權杖

---

## 建立 Access Policy

Policy 是獨立建立的存取規則，之後在 Application 中以引用方式套用。先建 Policy，再建 Application。

### 建立 Allow Policy（允許你自己存取）

1. 在 Zero Trust Dashboard 側邊欄，前往 **Access > Policies**

2. 點擊 **Create a policy**

3. 填寫：
   - **Policy name**：`Allow owner`
   - **Action**：`Allow`
   - 在 **Configure rules** 區塊，新增一條 **Include** 規則：
     - **Selector**：`Emails`
     - **Value**：填入你的 email 地址（例如 `you@example.com`）

4. 點擊 **Save** 儲存

### 建立 Bypass Policy（公開存取）

1. 再次點擊 **Create a policy**

2. 填寫：
   - **Policy name**：`Bypass all`
   - **Action**：`Bypass`
   - 在 **Configure rules** 的 **Include** 區塊：
     - **Selector**：`Everyone`

3. 儲存

> **說明**：`Allow owner` 之後會套用在主 Application 上，限制只有你能存取。`Bypass all` 之後會套用在 LINE webhook 和 PWA 靜態資源的 bypass Applications 上。

---

## 建立 Access Application

Application 定義了「哪個網站」要受到 Cloudflare Access 保護。

1. 在 Zero Trust Dashboard 側邊欄，前往 **Access > Applications**

2. 點擊 **Add an application**

3. 選擇 **Self-hosted**

4. 填寫 Application 資訊：
   - **Application name**：`Sparkle`
   - **Session Duration**：`7 days`（平衡便利性與安全性）或 `1 month`（偏重便利性，個人自用常見選擇）

5. 在 **Application domain** 區塊：
   - **Subdomain**：你的 Sparkle hostname 的子網域部分（例如 `sparkle`）
   - **Domain**：選擇你的網域（例如 `example.com`）
   - 完整的 URL 會是類似 `sparkle.example.com`
   - 如果你使用 `cfargotunnel.com`，直接填入完整的 hostname

6. 在 **Policies** 區塊，引用先前建立的 `Allow owner` policy

7. 儲存

> **提示**：Session Duration 越長，重新驗證頻率越低，但 session 被盜用後的有效時間也越長。若 Sparkle 是個人自用且裝置管理可信，可以選 `1 month` 來減少登入摩擦；若想更保守，選 `7 days`。

---

## 建立 Bypass Applications

某些路徑需要繞過 CF Access 認證，包括 LINE Bot webhook 和 PWA 靜態資源。每個 bypass 路徑建立一個獨立的 Application。

> **原理**：Cloudflare Access 會先匹配最具體的路徑。特定路徑的 bypass Application 會優先於主 Application，讓這些請求不需要登入。

### LINE Webhook Bypass

**這是關鍵步驟。** LINE 的伺服器需要直接存取 `/api/webhook/line` 端點來傳送訊息，不能經過 Cloudflare Access 的登入流程。如果不設定 bypass，LINE Bot 會完全無法運作。

> **安全警告**：Bypass 路徑務必設定為 `/api/webhook/`（精確路徑）。這確保只有 webhook 端點被公開，其餘所有 API 端點仍受 Cloudflare Access 保護。Sparkle 的 webhook 端點有自己的 LINE signature 驗證機制，所以 bypass 後仍然安全。

1. 前往 **Access > Applications** > **Add an application** > **Self-hosted**

2. 填寫：
   - **Application name**：`Sparkle LINE Webhook`
   - **Session Duration**：`24 hours`（無所謂，因為是 bypass）
   - **Application domain**：
     - **Subdomain**：與主 Application 相同（例如 `sparkle`）
     - **Domain**：與主 Application 相同（例如 `example.com`）
     - **Path**：`/api/webhook/`（精確填入，不要使用萬用字元）

3. 在 **Policies** 區塊，引用先前建立的 `Bypass all` policy

4. 儲存

#### 常見錯誤

以下是設定 Bypass 路徑時常見的錯誤，任何一項都可能導致嚴重安全漏洞：

| 錯誤路徑         | 風險                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/*` 或留空      | 整個網站完全暴露，任何人無需登入即可存取所有功能和資料                                                                  |
| `/api/*`         | 所有 API 端點暴露，攻擊者只需猜到 Bearer token 即可存取全部資料                                                         |
| `/api/webhook/*` | 雖然目前只有 `/api/webhook/line` 一個端點，但使用萬用字元會讓未來新增的任何 webhook 路徑自動被 bypass，違反最小權限原則 |

> **正確做法**：只 bypass `/api/webhook/`。如果未來新增其他 webhook 端點，再逐一評估是否需要 bypass。

### PWA 靜態資源 Bypass

瀏覽器在載入 PWA 時會自動抓取 manifest 和 service worker 等檔案。這些請求不一定會帶上 CF Access 的 session cookie，導致被攔截而無法安裝 PWA。需要將這些非敏感的靜態資源設為 bypass。

1. 前往 **Access > Applications** > **Add an application** > **Self-hosted**

2. 填寫：
   - **Application name**：`Sparkle PWA Assets`
   - **Session Duration**：`24 hours`（無所謂，因為是 bypass）
   - **Application domain**：
     - **Subdomain**：與主 Application 相同（例如 `sparkle`）
     - **Domain**：與主 Application 相同（例如 `example.com`）
     - **Path**：`/manifest.webmanifest`

3. 在 **Policies** 區塊，引用先前建立的 `Bypass all` policy

4. 儲存

> **說明**：`/manifest.webmanifest` 和 `/sw.js` 都是公開的靜態檔案，不含敏感資料，bypass 不會造成安全風險。如果 PWA 安裝仍有問題，可用相同方式為 `/sw.js` 再建一個 bypass Application。

---

## 驗證

完成以上設定後，請依序測試。

### 0. 快速驗證存取控制（命令列）

在終端機中執行以下指令，快速確認 Cloudflare Access 的路徑保護是否正確生效：

```bash
# 驗證 API 端點受保護（應回傳 302 導向 CF Access 登入，或 403 Forbidden）
curl -I https://YOUR_DOMAIN/api/items

# 驗證 webhook 可存取（應回傳 401 Unauthorized，因為缺少 LINE signature）
# 回傳 401 表示請求成功穿過 CF Access bypass，被 Sparkle 自己的驗證擋住 — 這是正確行為
curl -I -X POST https://YOUR_DOMAIN/api/webhook/line
```

將 `YOUR_DOMAIN` 替換為你的實際網域（例如 `sparkle.example.com`）。

**預期結果**：

| 端點                | 預期回應       | 意義                                                       |
| ------------------- | -------------- | ---------------------------------------------------------- |
| `/api/items`        | `302` 或 `403` | CF Access 正確保護 API                                     |
| `/api/webhook/line` | `401`          | Bypass 生效，請求到達 Sparkle 但缺少 LINE signature 被拒絕 |

> 如果 `/api/items` 回傳 `401` 而非 `302`/`403`，表示 CF Access 沒有保護該路徑，請檢查 Application 設定。

### 1. 測試網頁存取

1. 開啟瀏覽器，前往你的 Sparkle URL（例如 `https://sparkle.example.com`）
2. 你應該會看到 **Cloudflare Access 登入頁面**，而不是直接看到 Sparkle
3. 選擇你設定的登入方式（Email OTP / Google / GitHub）
4. 完成驗證後，你應該會被重新導向到 Sparkle 的介面
5. 確認可以正常瀏覽筆記、新增待辦等操作

### 2. 測試 LINE Bot

1. 在 LINE 上傳送一則訊息給你的 Sparkle Bot
2. Bot 應該正常回應（不會觸發 Cloudflare Access 登入流程）
3. 如果 Bot 沒有回應，請檢查：
   - Bypass Application 的路徑是否設定為 `/api/webhook/`
   - 主 Application 和 Bypass Application 的 domain 是否完全一致
   - Cloudflare Tunnel 是否正常運行：`sudo systemctl status cloudflared`

### 3. 測試 PWA

1. 在瀏覽器中開啟 Sparkle URL，完成 Cloudflare Access 登入
2. 應該看到 PWA 安裝提示（「安裝到主畫面，享受更好的體驗」）
3. 點擊安裝，從主畫面開啟 Sparkle，應該可以直接使用
4. 如果沒有出現安裝提示，開啟 DevTools（F12）> Console 檢查：
   - 如果看到 `manifest` 被 redirect 到 `cloudflareaccess.com` 的 CORS 錯誤 → 確認 PWA Assets bypass Application 已建立且路徑正確
   - 如果看到 `beforeinstallpromptevent.preventDefault() called` → 這是正常的，Sparkle 使用自訂安裝提示

---

## Service Token（程式化存取）

> **目前不需要設定。** MCP Server 和其他本機工具都透過 `localhost:3000` 直接存取 Sparkle API，不經過 Cloudflare Tunnel，因此不受 Cloudflare Access 影響。

如果未來你需要從外部網路程式化地存取 Sparkle API（不走 localhost），可以使用 Service Token：

1. 在 Zero Trust Dashboard，前往 **Access > Service Auth > Service Tokens**

2. 點擊 **Create Service Token**

3. 設定：
   - **Service Token name**：`Sparkle API`
   - **Service Token Duration**：選擇適合的期限

4. 建立後，記下 **Client ID** 和 **Client Secret**（Client Secret 只會顯示一次）

5. 在你的 API 請求中加入這兩個 HTTP header：

   ```
   CF-Access-Client-Id: <your-client-id>
   CF-Access-Client-Secret: <your-client-secret>
   ```

6. 回到 Sparkle Application 的 Policy，新增一條允許 Service Token 的規則：
   - **Policy name**：`Allow API access`
   - **Action**：`Service Auth`
   - **Include** rule：
     - **Selector**：`Service Token`
     - **Value**：選擇你剛建立的 token

> **注意**：使用 Service Token 時，請求仍需包含 Sparkle 自己的 `Authorization: Bearer <AUTH_TOKEN>` header。Service Token 只是通過 Cloudflare Access 這一層的驗證。

---

## 常見問題

### Q: Session 過期了怎麼辦？

重新登入即可。你在 Sparkle 中儲存的資料不受影響。如果你設定 `1 month` Session Duration，每個瀏覽器或 PWA 大約每月重新驗證一次；如果設定 `7 days`，則約每週一次。

### Q: `<your-team-name>` 是什麼？

這是你的 Cloudflare Zero Trust team name，不是 Sparkle app hostname。

查詢方式：

1. Cloudflare Dashboard > **Zero Trust**
2. 前往 **Settings**
3. 查看 **Team name and domain**

如果畫面顯示：

```text
Team domain: tim-home.cloudflareaccess.com
```

那麼 GitHub OAuth 要填：

```text
Homepage URL:
https://tim-home.cloudflareaccess.com

Authorization callback URL:
https://tim-home.cloudflareaccess.com/cdn-cgi/access/callback
```

不要填 `https://sparkle.example.com` 這類 Sparkle 公開網址。

### Q: GitHub 登入後出現 `That account does not have access`？

這代表 GitHub OAuth 成功，但 Cloudflare Access policy 沒有允許這個 GitHub identity。

排查步驟：

1. 前往 **Zero Trust > Insights > Logs**
2. 開啟 **Access authentication logs**
3. 找到最新的 denied Sparkle login
4. 打開該筆紀錄，確認 **User email** 和 **Connection**（應為 GitHub）
5. 前往 **Access controls > Policies**
6. 開啟 Sparkle 的 allow policy（例如 `Allow owner`）
7. 在 **Include** 規則中使用：
   - **Selector**：`Emails`
   - **Value**：Access log 裡顯示的 **User email**
8. 確認沒有錯誤的 **Require** 規則，例如舊的 One-time PIN、錯誤 email domain、或未設定好的 GitHub organization/team
9. 回到 **Access controls > Applications > Sparkle > Policies**，確認這個 allow policy 已套用到 Sparkle application

如果你使用 GitHub organization/team policy，且剛加入 organization 或剛修改權限，請到 GitHub > **Settings > Applications > Authorized OAuth Apps** 撤銷 Cloudflare Access，然後重新登入 Sparkle，讓 GitHub 重新授權並更新 organization/team 權限。

### Q: LINE Bot 不通怎麼辦？

1. 確認 LINE Webhook bypass Application 的路徑設定為 `/api/webhook/`，且 domain 與主 Application 完全一致
2. 確認該 bypass Application 已引用 `Bypass all` policy
3. 在 LINE Developers Console 點擊 **Verify** 測試 webhook 連線
4. 檢查 Cloudflare Tunnel 狀態：`sudo systemctl status cloudflared`
5. 查看 Tunnel 日誌：`sudo journalctl -u cloudflared -f`
6. 查看 Sparkle 日誌：`journalctl -u sparkle -f`

### Q: 想用多台裝置存取？

每台裝置各自登入一次就好。登入後，在 Session Duration 期間內不需要重新驗證。桌面瀏覽器、手機瀏覽器、PWA 各自獨立，都需要各自登入一次。

### Q: 可以讓多人使用嗎？

可以。在 Allow Policy 的 Include 規則中，你可以：

- 新增多個 email 地址
- 或使用 email domain 規則（例如允許所有 `@yourcompany.com` 的人）

免費方案最多支援 50 位使用者。

### Q: PWA 安裝提示沒有出現？

確認 PWA Assets bypass Application 已正確建立（path 為 `/manifest.webmanifest`）。開啟 DevTools Console 檢查是否有 CORS 錯誤。如果 `/sw.js` 也被攔截，用相同方式再建一個 bypass Application。

### Q: 之前用 VPN 存取，還需要嗎？

設定好 Cloudflare Access 後，你可以直接從公網安全地存取 Sparkle，不再需要 VPN 連線。不過，localhost 存取（MCP Server、本機開發等）不受影響，仍然可以正常使用。

### Q: 如何暫時關閉 Cloudflare Access？

在 Zero Trust Dashboard > Access > Applications 中，將 Sparkle Application 切換為 **Disabled**。注意：這會讓所有人都能不經驗證存取你的 Sparkle（Sparkle 自己的 Bearer token 驗證仍然有效）。

---

## 參考資料

- [Cloudflare Access: Self-hosted applications](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/)
- [Cloudflare Access: Session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Cloudflare Access: GitHub identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/github/)
- [Cloudflare Access: Policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Cloudflare Access: Authentication logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/dashboard-logs/access-authentication-logs/)
- [Cloudflare Zero Trust Free Plan](https://www.cloudflare.com/plans/zero-trust-services/)
- [Sparkle Cloudflare Tunnel 設定](../scripts/setup-cloudflared.sh)
