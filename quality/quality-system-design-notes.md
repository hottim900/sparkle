# 品質管理追蹤體系設計筆記

> 可移植到其他專案的品質管理追蹤方法論。
> 基於 ODC、DORA、GitHub Label Taxonomy 等業界實踐，
> 針對「單人/小團隊 + AI 開發」場景優化。

---

## 1. 設計原則

### 1.1 核心目標

為 **AI 輔助開發** 設計的品質追蹤系統，最高優先級是：

1. **AI 可自主操作** — 每個工作流步驟都有明確指引，不依賴隱性知識
2. **單一來源** — 每筆資料只存在一處，避免多處同步導致不一致
3. **可擴展** — 從 8 項到 800 項，結構不需改變

### 1.2 設計取捨

| 決策 | 選擇 | 放棄 | 理由 |
|------|------|------|------|
| Dashboard 策略 | README 只列 Critical/High | 列出所有項目 | 項目增長到 100+ 時 README 不膨脹 |
| 發現機制 | `glob` + `grep`（零維護） | INDEX.md 索引檔 | 減少冗餘，AI 本身就能搜尋 |
| 模板分類 | 三種獨立模板 | 一個模板 + 條件欄位 | 避免 AI 填錯不適用的欄位 |
| 檔名慣例 | ID 前綴（`DEF-001-xxx.md`） | 日期前綴 | 搜尋結果即時可辨識，不需開檔 |
| 優先級 vs 嚴重度 | 分離為兩個欄位 | 合併為一個 | 「何時修」和「多嚴重」是不同維度 |

---

## 2. 分類體系

### 2.1 四分類 + 決策樹

```
這個問題是有意識的妥協嗎？
├── 是 → Tech Debt（「我知道不夠好，先上線」）
└── 否 → 程式碼行為與設計意圖一致嗎？
    ├── 否 → Defect（逃逸缺陷 / 設計缺陷）
    └── 是 → 功能設計完整嗎？
        ├── 否 → Feature Gap（缺少的互動或資訊）
        └── 是 → 不需要追蹤
```

第四類 **Quality Gate** 獨立於決策樹 — 不是「要修的東西」，而是「防止前三類進入 codebase 的基礎設施」（例如架構測試、CI 品質關卡、搜查手冊）。

---

## 3. AI 效率優化設計

這是本體系與一般品質追蹤最大的差異。每個設計決策都考慮 AI 的工作方式。

### 3.1 發現性（AI 怎麼知道這個系統存在）

在專案的 `CLAUDE.md`（或等效的 AI 指令檔）加入入口：

```markdown
## 品質管理

活躍的缺陷、技術債、功能缺口追蹤在 `docs/plans/quality/README.md`。

**發現項目：** `glob docs/plans/quality/defects/DEF-*.md` + `grep '狀態.*Pending'`
**修復後必須更新：** 依照項目檔底部「完成步驟」checklist 逐項執行。
**建立新項目：** 依照 README.md「建立新項目」段落操作。
```

### 3.2 完成步驟 Checklist（AI 防遺漏）

每個項目檔底部有明確的完成步驟。AI 最常犯的錯就是改完原始碼但忘記更新追蹤文件。

### 3.3 待追蹤發現的行動指引

明確告訴 AI「不要主動升級為正式項目」，避免 AI 過度主動地建立大量低優先級項目。

### 3.4 雙向連結

- **Taxonomy → Item：** 搜查手冊每個已知實例有可點擊連結到 DEF 項目
- **Item → Taxonomy：** 每個 Defect 的「缺陷子類別」有可點擊連結到搜查手冊段落

### 3.5 AI 效率 Checklist（移植到新專案時確認）

| # | 項目 | 驗證方式 |
|---|------|---------|
| 1 | CLAUDE.md 有品質系統入口 | `grep '品質管理' CLAUDE.md` |
| 2 | 每個項目有「完成步驟」checklist | `grep -rl '完成步驟' docs/plans/quality/` |
| 3 | Checklist 包含「更新統計概覽」 | `grep -rl '統計概覽' docs/plans/quality/defects/` |
| 4 | README 只列 Critical/High | 目視確認 Medium/Low 不在表格中 |
| 5 | 搜查手冊有反向連結到 DEF 項目 | `grep -c '\[DEF-' defect-taxonomy.md` |
| 6 | DEF 項目有正向連結到搜查手冊 | `grep '\[D-' docs/plans/quality/defects/DEF-*.md` |
| 7 | README 有「建立新項目」流程 | `grep '建立新項目' README.md` |
| 8 | 「待追蹤發現」有行動指引 | `grep 'AI 行動指引' README.md` |

---

## 4. 方法論來源

| 來源 | 採用的概念 |
|------|-----------|
| [Orthogonal Defect Classification (ODC)](https://en.wikipedia.org/wiki/Orthogonal_Defect_Classification) | Root Cause 分類、Trigger（逃逸階段）、可重複的搜查模式 |
| [DORA Metrics](https://dora.dev/guides/dora-metrics/) | Change Failure Rate 的概念 → 逃逸階段追蹤 |
| [GitHub Label Taxonomy](https://robinpowered.com/blog/best-practice-system-for-organizing-and-tagging-github-issues) | 前綴式分類（type: / priority: / status:） |
| [Shift-Left Testing](https://www.sonarsource.com/resources/library/shift-left/) | 搜查手冊 → 自動化防線的演進路徑 |
| [Escaped Defect Analysis](https://softwareengineeringauthority.com/index.php/tools/13-software-engineering-disciplines/14-escaped-defect-analysis) | 逃逸階段欄位設計 |
| [Martin Fowler Tech Debt Quadrant](https://en.wikipedia.org/wiki/Technical_debt) | Deliberate vs Inadvertent → 決策樹的「有意識的妥協」分支 |
