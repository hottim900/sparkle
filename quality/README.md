# 品質管理追蹤

你的專案的品質管理體系。追蹤缺陷、技術債、功能缺口、測試覆蓋與工具建設，並維護品質防線。

透過 GitHub Issues / GitLab Issues 管理品質項目，搭配 [defect-taxonomy.md](./defect-taxonomy.md) 搜查手冊進行系統性缺陷掃查。

---

## 快速查詢

> 品質項目以 Issue 追蹤，透過 label 過濾取得即時結果。
> 以下指令以 `gh` (GitHub) 為例，GitLab 替換為 `glab`。

| 查詢               | 指令                                                              |
| ------------------ | ----------------------------------------------------------------- |
| 活躍項目           | `gh issue list --label "type:defect" --state open`                |
| Critical/High 活躍 | `gh issue list --label "priority:critical" --state open`          |
| In Progress 項目   | `gh issue list --label "status:in-progress" --state open`         |
| Blocked 項目       | `gh issue list --label "status:blocked-by-decision" --state open` |
| 搜查進度           | 見 [defect-taxonomy.md 分類總覽](./defect-taxonomy.md#分類總覽)   |
| 統計報告           | `gh issue list --state all \| wc -l`（總數）                      |

---

## 分類體系

| 分類                    | 定義                                                | 處理策略                | Label                       |
| ----------------------- | --------------------------------------------------- | ----------------------- | --------------------------- |
| **Defect**              | 非預期的錯誤，寫入時就是錯的                        | 立即修復 + 回溯流程漏洞 | `type:defect`               |
| **Tech Debt**           | 有意識的妥協，先上線再改                            | 排優先級，安排容量      | `type:tech-debt`            |
| **Feature Gap**         | 功能不完整，缺少預期互動                            | 放進 backlog            | `type:feature-gap`          |
| **Test Infrastructure** | 測試覆蓋缺口與測試工具建設                          | 排優先級，系統性補齊    | `type:test-infra`           |
| **Quality Gate**        | 防止 Defect / Tech Debt / Feature Gap 進入 codebase | 持續投資的基礎設施      | （例如 CI、搜查手冊、hook） |

### 如何判斷分類？

```
這個問題是有意識的妥協嗎？
├── 是 → 妥協的是測試覆蓋或測試工具嗎？
│   ├── 是 → Test Infrastructure（「知道該寫測試，先上線再補」）
│   └── 否 → Tech Debt（「我知道不夠好，先上線」）
└── 否 → 程式碼行為與設計意圖一致嗎？
    ├── 否 → Defect（逃逸缺陷 / 設計缺陷）
    └── 是 → 功能設計完整嗎？
        ├── 否 → 缺少的是測試覆蓋嗎？
        │   ├── 是 → Test Infrastructure（未覆蓋的測試路徑或缺少的測試工具）
        │   └── 否 → Feature Gap（缺少的互動或資訊）
        └── 是 → 不需要追蹤
```

---

## 定義參考

### 狀態

| 狀態                    | Issue 對應                          | 定義                                  |
| ----------------------- | ----------------------------------- | ------------------------------------- |
| **Pending**             | Open（無 status label）             | 已記錄，等待處理                      |
| **In Progress**         | Open + `status:in-progress`         | 正在修復中                            |
| **Blocked-by-Decision** | Open + `status:blocked-by-decision` | 解決方案需要人類決策，AI 不應自行推進 |
| **Done**                | Closed                              | 修復完成，已通過驗收                  |

### 優先級（業務緊急度 — 何時修）

| 優先級       | 定義                       | 處理時機              |
| ------------ | -------------------------- | --------------------- |
| **Critical** | 影響生產穩定性或安全性     | 立即處理（同日）      |
| **High**     | 阻礙開發效率或造成頻繁 bug | 下個 Sprint（1-2 週） |
| **Medium**   | 增加維護成本但不影響功能   | 規劃中處理（1 個月）  |
| **Low**      | 改善開發體驗，非必要       | 有空時處理（無 SLA）  |

### 嚴重度（技術影響 — 多嚴重，Defect 專用）

| 嚴重度          | 定義                        | 範例                       |
| --------------- | --------------------------- | -------------------------- |
| **S1-Critical** | 系統不可用或資料遺失        | 寫入操作靜默遺失資料       |
| **S2-Major**    | 功能異常，無合理 workaround | API 回傳錯誤的 status code |
| **S3-Minor**    | 功能異常，有 workaround     | 手動刷新頁面可繞過         |
| **S4-Trivial**  | 外觀/文字問題               | 錯誤訊息措辭不佳           |

### 成本（實作工時）

| 代號   | 範圍          | 說明                 |
| ------ | ------------- | -------------------- |
| **S**  | < 2 小時      | 簡單修復，單一改動   |
| **M**  | 2 小時 ~ 1 天 | 中等複雜度，多個檔案 |
| **L**  | 1 ~ 3 天      | 複雜修復，需要設計   |
| **XL** | > 3 天        | 大型重構，建議分階段 |

### 根因類別（Defect 專用）

| 根因                       | 定義                         |
| -------------------------- | ---------------------------- |
| **Design Defect**          | 架構/設計層面的錯誤決策      |
| **Implementation Error**   | 實作與設計意圖不符           |
| **Configuration Omission** | 配置遺漏（框架、建置工具等） |
| **Framework Limitation**   | 框架已知限制未規避           |
| **Missing Test Coverage**  | 缺少測試導致未發現           |

### 逃逸階段（Defect 專用）

| 階段                 | 說明                     |
| -------------------- | ------------------------ |
| **Code Review**      | 初次實作時 review 未捕獲 |
| **Unit Test**        | 單元測試未覆蓋此路徑     |
| **Integration Test** | 整合測試未覆蓋此場景     |
| **E2E Test**         | E2E 測試未覆蓋此場景     |
| **Production**       | 生產環境使用者發現       |

#### 升級與降級信號

優先級不是固定的 — 隨情境變化調整。以下為常見信號，非硬性規則：

**升級（例如 Medium → High）：**

- 同類問題重複出現（第二次遇到 = 模式，不再是偶發）
- 外部依賴變化（上游 API 即將 deprecate、安全漏洞公告）
- 影響範圍擴大（原本只影響一個功能，發現波及多處）
- 阻擋其他項目進展

**降級（例如 High → Medium）：**

- 找到有效的 workaround 且已記錄
- 影響範圍確認比預期小（例如只在特定邊界條件觸發）
- 外部壓力消失（deadline 延後、相關功能暫停開發）

> **操作：** 調整優先級時，更新 Issue 的 `priority:` label 並在 comment 簡述變更原因。

---

## Label 參考

| Prefix        | 用途               | 必填？                                             | 值                                                                            |
| ------------- | ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `type:`       | 項目類型           | **必填**（GitHub 模板自動套用；GitLab 需手動加上） | `defect` / `tech-debt` / `feature-gap` / `test-infra`                         |
| `priority:`   | 優先級             | **必填**                                           | `critical` / `high` / `medium` / `low`                                        |
| `status:`     | 細分狀態           | 選填                                               | `in-progress` / `blocked-by-decision`                                         |
| `severity:`   | 嚴重度（Defect）   | 選填，建議填                                       | `s1-critical` / `s2-major` / `s3-minor` / `s4-trivial`                        |
| `cost:`       | 成本               | 選填                                               | `s` / `m` / `l` / `xl`                                                        |
| `escape:`     | 逃逸階段（Defect） | 選填，建議填                                       | `code-review` / `unit-test` / `integration-test` / `e2e-test` / `production`  |
| `root-cause:` | 根因（Defect）     | 選填                                               | `design` / `implementation` / `configuration` / `framework` / `test-coverage` |

> 各專案可擴充 `defect-category:d-xxx` label 對應自己的 taxonomy。

---

## 搜查手冊

定義所有已知缺陷類別和可重複執行的搜查模式：**[defect-taxonomy.md](./defect-taxonomy.md)**

---

## 待追蹤發現

搜查中發現但尚未建立正式項目的問題。

> **AI 行動指引：** 此段落僅供參考。**不要主動升級為正式項目** — 由人類決定何時建立。
> 若人類要求處理某項，再依「建立新項目」流程操作。

- **`type DB` alias 散佈 4 個 server 檔案**：`items.ts`, `item-enrichment.ts`, `categories.ts`, `line-commands/types.ts` 各自定義相同的 `type DB = BetterSQLite3Database<typeof schema>`。可抽到 `server/db/index.ts` 統一 export。（發現於 2026-03-16）
- **`test-utils.ts` 缺少 migration 14 的兩個 index**：`idx_items_viewed_at` 和 `idx_items_status_modified` 已加入 production schema，但 `server/test-utils.ts` 未同步。（發現於 2026-03-21）

---

## 建立新項目

1. 用[分類決策樹](#如何判斷分類)判斷類型（Defect / Tech Debt / Feature Gap / Test Infrastructure）
2. 用對應的 Issue 模板建立 Issue：
   - GitHub：`gh issue create --template defect.yml`（或 `tech-debt.yml` / `feature-gap.yml` / `test-infra.yml`）
   - GitLab：`glab issue create --template Defect`（或 `Tech-Debt` / `Feature-Gap` / `Test-Infrastructure`）
3. 填寫模板中的所有欄位，加上 `priority:` label
   > **注意：** 模板的下拉選單僅記錄在 Issue body 中，不會自動建立對應的 label。`type:` label 由 GitHub 模板自動套用，其他 label（`priority:`、`severity:` 等）需手動加上。
4. 若 Defect，填寫「缺陷子類別」（對應 [defect-taxonomy.md](./defect-taxonomy.md) 的 D-XXX 代碼）
5. 開始處理時，加上 `status:in-progress` label

---

## 完成步驟

> **IMPORTANT:** 修復完成後，依序執行以下步驟。缺任何一步 = 未完成。

1. 關閉 Issue，填寫完成 comment：
   ```
   ## 完成紀錄
   **Commit/PR：** abc1234 或 PR 連結
   **修改摘要：** 簡述實際修改
   **測試結果：** X passed, 0 failed
   ```
2. 若有相依 Issue（Complements/Blocks）→ 檢查對方 Issue 是否需更新
3. 若為 Defect 且在系統性搜查中發現 → 確認搜查結果已記錄於 [defect-taxonomy.md](./defect-taxonomy.md)
