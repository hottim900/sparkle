---
name: quality
description: Quality tracking system operations guide. Use when fixing bugs, managing defect/tech-debt/feature-gap items, or running code quality audits.
user-invocable: true
---

# 品質管理追蹤系統

## 路徑解析（重要）

品質追蹤檔案 **不在主 git repo 中**（gitignored），而是在主目錄的獨立本地 git repo：

```
/home/tim/sparkle/docs/plans/quality/    ← 品質檔案的絕對路徑（獨立 git repo）
```

**所有 Claude session 都在 worktree 中執行**，worktree 裡不會有 `docs/plans/quality/`。
操作品質檔案時，**一律使用絕對路徑** `/home/tim/sparkle/docs/plans/quality/`。

| 檔案 | 絕對路徑 |
|------|---------|
| Dashboard | `/home/tim/sparkle/docs/plans/quality/README.md` |
| 搜查手冊 | `/home/tim/sparkle/docs/plans/quality/defect-taxonomy.md` |
| 設計筆記 | `/home/tim/sparkle/docs/plans/quality/quality-system-design-notes.md` |
| Defect 模板 | `/home/tim/sparkle/docs/plans/quality/TEMPLATE-DEFECT.md` |
| Tech Debt 模板 | `/home/tim/sparkle/docs/plans/quality/TEMPLATE-TECH-DEBT.md` |
| Feature Gap 模板 | `/home/tim/sparkle/docs/plans/quality/TEMPLATE-FEATURE-GAP.md` |

---

## 快速操作

### 發現活躍項目

```bash
# 列出所有活躍 Defect
glob /home/tim/sparkle/docs/plans/quality/defects/DEF-*.md

# 列出所有活躍 Tech Debt
glob /home/tim/sparkle/docs/plans/quality/tech-debt/TD-*.md

# 列出所有活躍 Feature Gap
glob /home/tim/sparkle/docs/plans/quality/feature-gaps/FG-*.md

# 搜尋特定狀態的項目
grep '狀態.*Pending' /home/tim/sparkle/docs/plans/quality/defects/
grep '狀態.*In Progress' /home/tim/sparkle/docs/plans/quality/defects/
```

### 建立新項目

1. **判斷類型** — 用決策樹：
   ```
   有意識的妥協？→ Tech Debt
   行為與意圖不符？→ Defect
   功能設計不完整？→ Feature Gap
   ```

2. **決定 ID** — `ls` 對應目錄找最大編號 +1

3. **複製模板** — `cp TEMPLATE-{TYPE}.md {dir}/{ID}-short-description.md`

4. **填寫 metadata** — 所有欄位都要填（參照 README.md 定義）

5. **更新 Dashboard** — 若 Critical/High → 加入 README Critical/High 表 + 更新統計

6. **連結搜查手冊** — Defect 的「缺陷子類別」欄位連結到 defect-taxonomy.md 對應段落

### 修復完成後（完成步驟 Checklist）

> **IMPORTANT:** 每一步都要做，缺任何一步 = 未完成。

- [ ] 項目檔「狀態」改為 Done
- [ ] 填寫項目檔「完成紀錄」（Commit、修改摘要、測試結果）
- [ ] 若在 README Critical/High 表中 → 移除該行
- [ ] 更新 README 統計概覽（活躍項目數、Critical/High 計數）
- [ ] 若有相依項目（Complements/Blocks）→ 檢查對方是否需更新
- [ ] 搜查手冊的「已知實例」加入本項連結

### 品質檔案版本控制

品質追蹤檔案在 private companion repo（`hottim900/sparkle-quality`），本地路徑同上。
建立或更新品質項目後，commit + push：

```bash
cd /home/tim/sparkle/docs/plans/quality && git add -A && git commit -m "描述變更" && git push
```

---

## 分類體系

| 分類 | 定義 | 模板 | 目錄 |
|------|------|------|------|
| **Defect** | 非預期的錯誤，寫入時就是錯的 | `TEMPLATE-DEFECT.md` | `defects/` |
| **Tech Debt** | 有意識的妥協，先上線再改 | `TEMPLATE-TECH-DEBT.md` | `tech-debt/` |
| **Feature Gap** | 功能不完整，缺少預期互動 | `TEMPLATE-FEATURE-GAP.md` | `feature-gaps/` |

## 搜查手冊（Defect Taxonomy）

系統性搜查工具，定義 Sparkle 專案的已知缺陷類別。每個類別有：
- **定義**：什麼模式構成此類缺陷
- **搜查方式**：可執行的 grep/搜查指令
- **判定標準**：如何判斷是否為缺陷
- **已知實例**：連結到 DEF 項目

目前定義的缺陷類別：

| 代號 | 缺陷類別 | 層級 |
|------|---------|------|
| D-SILENT | 靜默失敗與錯誤吞沒 | 全層 |
| D-VALID | 輸入驗證缺口 | API |
| D-STATE | 前端狀態管理不一致 | Frontend |
| D-OFFLINE | 離線同步與 PWA 問題 | Frontend / SW |
| D-QUERY | 查詢語意錯誤 | Server |
| D-MIGRATE | DB Migration 安全性 | Server |
| D-AUTH | 認證與授權缺口 | API |
| D-EDGE | 邊界條件與資源限制 | 全層 |
| D-TYPE | TypeScript 型別安全漏洞 | Frontend / Server |
| D-PERF | 效能問題 | 全層 |

執行搜查時，讀取 `/home/tim/sparkle/docs/plans/quality/defect-taxonomy.md` 取得每個類別的具體搜查指令。

---

## 行為準則

- **修復 bug 時**：檢查是否有對應的品質追蹤項目。若無且是系統性問題 → 建議建立（但由人類決定）。
- **發現新問題時**：記錄到 README「待追蹤發現」段落。**不要主動升級為正式項目**。
- **搜查手冊中發現同類問題時**：記錄到搜查手冊的「搜查結果」中。
- **完成修復後**：嚴格執行「完成步驟 Checklist」，不要遺漏任何一步。
