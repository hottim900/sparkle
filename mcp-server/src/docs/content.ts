/**
 * Documentation content map — shared by MCP Resources and sparkle_guide tool.
 * All content in 繁體中文.
 */
export const DOCS: Record<
  string,
  { title: string; description: string; content: string }
> = {
  overview: {
    title: "Sparkle 概覽",
    description: "Sparkle 的設計理念、核心功能與三種項目類型介紹",
    content: `# Sparkle 概覽

Sparkle 是一個自架的個人知識管理 PWA，結合 **Zettelkasten 筆記成熟度流程**與 **GTD 待辦管理**，幫助你從靈感捕捉到知識沉澱的完整旅程。

## 三種項目類型

### 筆記 (note)
遵循 Zettelkasten 成熟度流程：閃念 → 發展中 → 永久 → 已匯出。
用途：記錄想法、學習筆記、知識卡片。每張筆記從粗糙的靈感逐步發展為完整、自足的知識單元。

### 待辦 (todo)
簡化的 GTD 任務管理：active → done → archived。
支援優先度 (high/medium/low/none)、到期日、以及與筆記的關聯（追蹤待辦）。

### 暫存 (scratch)
臨時的草稿空間：draft → archived。
用於暫時存放片段資訊、未分類的內容。可升級為閃念筆記或直接封存。

## 設計理念

- **手機快速捕捉**：PWA 支援離線，隨時記下靈感
- **桌面深度編輯**：Markdown 編輯器，適合整理和發展筆記
- **LINE Bot 隨時記錄**：透過聊天介面快速新增和查詢
- **Obsidian 匯出**：永久筆記匯出為 .md 檔案，融入長期知識庫

## 核心流程

捕捉想法 → 分類整理 → 深化發展 → 匯出沉澱

Sparkle 專注於知識的「孵化」階段——從模糊的靈感到成熟的知識卡片。當筆記發展完成，匯出到 Obsidian 成為永久知識庫的一部分。`,
  },

  zettelkasten: {
    title: "Zettelkasten 筆記流程",
    description: "筆記成熟度階段、品質標準與推進時機",
    content: `# Zettelkasten 筆記流程

筆記遵循成熟度流程，每個階段有明確的品質標準：

## 閃念 (fleeting)

快速捕捉的原始想法，未經整理。可能只是一句話、一個問題、一個片段。

**特徵**：簡短、粗糙、不完整
**範例**：「分散式系統的 CAP 定理好像跟我上次讀的論文有關」

**推進時機**：當你開始擴展這個想法——加入脈絡、提出問題、連結相關概念時，推進到「發展中」。

## 發展中 (developing)

已開始擴展的筆記，有初步結構但尚未完整。

**特徵**：
- 有明確的主題或論點
- 加入了背景脈絡和相關資訊
- 可能包含問題、待驗證的假設
- 有初步的段落結構

**推進時機**：當筆記符合以下條件時，推進到「永久」：
1. 論述完整、邏輯清晰
2. 不依賴外部脈絡即可理解
3. 有明確的知識貢獻

## 永久 (permanent)

完整、自足的知識卡片。這是 Zettelkasten 的核心產出。

**品質標準**：
- **自足性**：單獨閱讀即可理解，不需要「那個討論」的背景
- **原子性**：聚焦單一概念或論點
- **連結性**：透過標籤和別名與其他知識連結
- **自己的話**：用自己的理解重新表述，不是複製貼上

## 已匯出 (exported)

已寫入 Obsidian vault 的筆記。匯出後如果修改標題或內容，狀態會自動回退為「永久」，需要重新匯出。

## 已封存 (archived)

不再需要但保留記錄的筆記。任何階段都可以封存。

## 推進操作

使用 \`sparkle_advance_note\` 工具推進筆記：
- fleeting → developing：\`target_status: "developing"\`
- developing → permanent：\`target_status: "permanent"\`

匯出到 Obsidian：使用 \`sparkle_export_to_obsidian\` 工具（僅限 permanent 狀態）。`,
  },

  gtd: {
    title: "待辦管理 (GTD)",
    description: "待辦的狀態、優先度、到期日與追蹤待辦機制",
    content: `# 待辦管理 (GTD)

待辦 (todo) 使用簡化的 GTD 生命週期管理任務。

## 狀態流程

- **active**（進行中）：需要處理的任務
- **done**（已完成）：已完成的任務
- **archived**（已封存）：不再需要的任務

## 優先度

四個等級，由高到低：
- **high**：緊急重要，需要立即處理
- **medium**：重要但不緊急
- **low**：可以稍後處理
- **none**（null）：未設定優先度

## 到期日

- 格式：YYYY-MM-DD（如 2026-03-15）
- 僅 todo 類型支援到期日
- 筆記 (note) 類型會忽略到期日設定
- 待辦轉換為筆記時，到期日會被清除

## 追蹤待辦 (linked_note_id)

待辦可以透過 \`linked_note_id\` 關聯到一個筆記，形成「追蹤待辦」。

**用途**：
- 為一個筆記主題建立具體的行動項目
- 追蹤某個想法需要的後續動作
- 將抽象的知識轉化為可執行的任務

**注意**：
- \`linked_note_id\` 僅 todo 類型有效
- 待辦轉換為筆記時，linked_note_id 會被清除
- API 回應中的 \`linked_note_title\` 是計算欄位，顯示關聯筆記的標題
- API 回應中筆記的 \`linked_todo_count\` 顯示關聯的非封存待辦數量

> **MCP 工具限制**：目前 MCP 工具無法建立待辦（僅支援 note 和 scratch）、無法設定 linked_note_id、priority 或 due。這些操作需透過 Sparkle 網頁介面或 LINE Bot。

## 查詢待辦

使用 \`sparkle_list_notes\` 搭配 \`type: "todo"\` 篩選：
- 進行中：\`status: "active"\`
- 已完成：\`status: "done"\`
- 按優先度排序：\`sort: "priority"\`
- 按到期日排序：\`sort: "due"\``,
  },

  scratch: {
    title: "暫存管理",
    description: "暫存的用途、升級為筆記的流程與清理建議",
    content: `# 暫存管理

暫存 (scratch) 是臨時的草稿空間，用於存放尚未分類的片段資訊。

## 用途

- 臨時筆記、隨手記錄
- 從其他地方複製的片段
- 尚未決定歸類的內容
- 不需要進入知識管理流程的雜項

## 狀態

- **draft**（草稿）：預設狀態，表示暫存中
- **archived**（已封存）：不再需要

## 升級為筆記

當暫存內容值得進入知識管理流程時，可以升級為閃念筆記。

> **注意**：目前 MCP 工具不支援直接變更類型。類型轉換需透過 Sparkle 網頁介面或 LINE Bot 操作。

**自動對應規則**（類型轉換時）：
- draft → fleeting（草稿變為閃念筆記）
- archived → archived（維持封存）

**欄位清除**：暫存不支援 tags、priority、due、aliases、linked_note_id，這些欄位在暫存中為空。升級為筆記後可以開始設定這些欄位。

## 降級為暫存

筆記或待辦也可以轉換為暫存，但要注意（需透過網頁介面或 LINE Bot）：
- 轉換時 tags、priority、due、aliases、linked_note_id 都會被清除
- fleeting/developing → draft
- permanent/exported → archived
- active → draft, done → archived

## 什麼時候該升級？

- 內容有發展價值，想要深入探討 → 升級為筆記
- 有具體的行動項目 → 升級為待辦（\`type: "todo"\`）
- 只是暫時參考，用完即丟 → 保持暫存或封存

## 定期清理

建議定期檢視暫存項目：
- 有價值的升級為筆記或待辦
- 已無用處的封存處理
- 避免暫存區堆積過多未處理項目`,
  },

  workflow: {
    title: "常見工作流",
    description: "從捕捉到匯出的完整流程與常見操作步驟",
    content: `# 常見工作流

## 完整流程：捕捉 → 分類 → 發展 → 匯出

### 1. 捕捉
快速記下靈感，不需要整理：
- \`sparkle_create_note\` 建立閃念筆記（預設 type: "note", status: "fleeting"）
- 標題簡短扼要，內容可以是片段

### 2. 分類整理
定期回顧閃念筆記，決定方向：
- 用 \`sparkle_list_notes\` 搭配 \`status: "fleeting"\` 列出待整理的筆記
- 有價值的加上標籤 (\`tags\`)，開始擴展
- 需要行動的建立追蹤待辦
- 不需要的封存

### 3. 深化發展
與 Claude 討論，逐步豐富筆記內容：
- 讀取筆記：\`sparkle_get_note\`
- 討論、分析、補充觀點
- 寫回更新：\`sparkle_update_note\`
- 達到發展中標準：\`sparkle_advance_note\` → developing
- 繼續深化直到完整自足
- 達到永久標準：\`sparkle_advance_note\` → permanent

### 4. 匯出沉澱
- 確認筆記品質符合永久標準
- \`sparkle_export_to_obsidian\` 匯出到 Obsidian vault

## 整理閃念筆記

幫使用者整理閃念筆記的建議步驟：
1. \`sparkle_list_notes\` 列出所有 fleeting 筆記
2. 逐一讀取，了解內容
3. 與使用者討論每則筆記的價值和方向
4. 有價值的：補充脈絡、加標籤、推進到 developing
5. 需要行動的：建立追蹤待辦
6. 已過時的：封存

## 深化一個主題

1. \`sparkle_get_note\` 讀取目標筆記
2. 分析現有內容，提出延伸問題
3. 與使用者對話，探討不同面向
4. 整合討論結果，重新組織筆記結構
5. \`sparkle_update_note\` 寫回豐富後的內容
6. 評估是否達到下一階段的標準

## 從筆記建立追蹤待辦

> **注意**：目前 MCP 工具無法直接建立待辦。建立待辦、設定優先度和到期日需透過 Sparkle 網頁介面或 LINE Bot。

1. 閱讀筆記，識別需要行動的項目
2. 建議使用者透過網頁介面或 LINE Bot 建立追蹤待辦
3. 可透過 \`sparkle_list_notes\` 搭配 \`type: "todo"\` 查看已建立的待辦

## 使用標籤組織知識

- \`sparkle_list_tags\` 查看現有標籤，保持一致性
- 相關主題使用相同標籤，方便後續篩選
- \`sparkle_list_notes\` 搭配 \`tag\` 參數按標籤瀏覽`,
  },

  "data-model": {
    title: "資料模型",
    description: "所有欄位定義、狀態轉換規則與類型轉換對應表",
    content: `# 資料模型

## 欄位定義

| 欄位 | 說明 |
|------|------|
| id | UUID 唯一識別碼 |
| type | 類型：note / todo / scratch |
| title | 標題（1-500 字元） |
| content | 內容（Markdown，最多 50000 字元） |
| status | 狀態（依類型不同，見下方） |
| priority | 優先度：high / medium / low / null |
| due | 到期日：YYYY-MM-DD（僅 todo 有效） |
| tags | 標籤陣列（最多 20 個，每個最多 50 字元） |
| origin | 來源管道（LINE / web / import） |
| source | 參考 URL（可為 null） |
| aliases | 別名陣列（用於 Obsidian 連結，最多 10 個） |
| linked_note_id | 關聯筆記 ID（僅 todo 有效，可為 null） |
| created | 建立時間（ISO 8601） |
| modified | 修改時間（ISO 8601） |

## 計算欄位（API 回應中自動產生）

| 欄位 | 說明 |
|------|------|
| linked_todo_count | 關聯的非封存待辦數量（筆記專用，待辦為 0） |
| linked_note_title | 關聯筆記的標題（待辦專用，無關聯為 null） |
| share_visibility | 分享狀態：public / unlisted / null |

## 各類型的有效狀態

| 類型 | 有效狀態 | 預設 |
|------|---------|------|
| note | fleeting, developing, permanent, exported, archived | fleeting |
| todo | active, done, archived | active |
| scratch | draft, archived | draft |

## 類型轉換自動對應

轉換類型時，狀態會自動對應。此對應會覆蓋顯式指定的 status。

### todo → note
| 原狀態 | 對應狀態 |
|--------|---------|
| active | fleeting |
| done | permanent |
| archived | archived |

### note → todo
| 原狀態 | 對應狀態 |
|--------|---------|
| fleeting | active |
| developing | active |
| permanent | done |
| exported | done |
| archived | archived |

### scratch → note
| 原狀態 | 對應狀態 |
|--------|---------|
| draft | fleeting |
| archived | archived |

### scratch → todo
| 原狀態 | 對應狀態 |
|--------|---------|
| draft | active |
| archived | archived |

### note → scratch
| 原狀態 | 對應狀態 |
|--------|---------|
| fleeting | draft |
| developing | draft |
| permanent | archived |
| exported | archived |
| archived | archived |

### todo → scratch
| 原狀態 | 對應狀態 |
|--------|---------|
| active | draft |
| done | archived |
| archived | archived |

## 轉換時的欄位清除規則

- **todo → note**：清除 due 和 linked_note_id
- **任何類型 → scratch**：清除 tags、priority、due、aliases、linked_note_id
- **已匯出筆記修改標題或內容**：狀態自動回退為 permanent`,
  },

  tips: {
    title: "最佳實踐",
    description: "標籤策略、別名用法、知識組織與定期維護建議",
    content: `# 最佳實踐

## 標籤策略

- **少而精**：避免過多標籤造成分類混亂，每則筆記 2-5 個標籤為宜
- **保持一致**：使用 \`sparkle_list_tags\` 查看現有標籤，優先使用已有的標籤
- **層次分明**：可用前綴區分類別，如「技術/」「生活/」「專案/」
- **定期整理**：合併意義相近的標籤，移除不再使用的標籤

## 別名 (aliases)

別名用於 Obsidian 雙向連結，讓同一則筆記可以用不同名稱被引用。

**適用場景**：
- 中英文名稱：筆記標題「分散式系統」，別名 "distributed systems"
- 縮寫：標題「持續整合/持續部署」，別名 "CI/CD"
- 常見替代說法：標題「知識管理」，別名「PKM」「personal knowledge management」

## 筆記連結 (linked_note_id)

善用待辦與筆記的關聯，建立知識與行動的橋樑：
- 讀完一篇文章，建立筆記記錄要點，再建立待辦追蹤「實作文章中的方法」
- 學習新概念時，筆記記錄理解，待辦追蹤「找更多範例驗證」
- 查看筆記的 \`linked_todo_count\` 了解還有多少待辦未完成

## 知識組織建議

### 定期整理閃念筆記
- 建議每週花 15-30 分鐘回顧閃念筆記
- 有價值的推進到發展中，過時的封存
- 避免閃念筆記堆積超過 20-30 則

### 避免囤積
- 暫存區用完就清：升級或封存
- 已完成的待辦定期封存
- 已匯出的筆記不需要保留在 Sparkle（Obsidian 是長期庫）

### 發展筆記的技巧
- 一次專注發展一個主題
- 加入「為什麼這很重要」的段落
- 用自己的話重新表述，不要複製貼上
- 加入具體範例和應用場景
- 考慮與其他筆記的關聯，用標籤串連

### 善用搜尋
- \`sparkle_search\` 支援中文全文搜尋
- 搜尋結果包含所有類型（筆記、待辦、暫存）
- 善用搜尋找到相關的舊筆記，建立連結`,
  },
};
