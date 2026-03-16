import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../../db/schema.js";
import { getItem } from "../items.js";
import { getItemId } from "../line-session.js";
import type { SessionResult } from "./types.js";

type DB = BetterSQLite3Database<typeof schema>;

export function resolveSessionItem(db: DB, userId: string, index: number): SessionResult {
  const itemId = getItemId(userId, index);
  if (!itemId) return { ok: false, error: `❌ 編號 ${index} 不存在，請重新查詢` };
  const item = getItem(db, itemId);
  if (!item) return { ok: false, error: "❌ 項目不存在" };
  return { ok: true, itemId, item };
}

export const HELP_TEXT = `📝 Sparkle 使用說明

【新增】
直接輸入文字 → 存為閃念筆記
!todo 買牛奶 → 存為待辦
!high 緊急事項 → 高優先筆記
!todo !high 繳費 → 高優先待辦

多行訊息：第一行為標題，其餘為內容

【暫存】
!tmp 暫存內容 → 快速建立暫存
!scratch → 列出暫存項目
!s → !scratch 簡寫
!delete N → 刪除項目
!upgrade N → 暫存升級為閃念筆記

【查詢】
!fleeting → 閃念筆記
!developing → 發展中筆記
!permanent → 永久筆記
!active → 進行中待辦
!notes → 所有筆記
!todos → 所有待辦
!today → 今日焦點
!find 關鍵字 → 搜尋項目
!list 標籤 → 按標籤篩選
!stats → 統計摘要

【筆記推進】查詢後用編號操作
!develop N → 閃念 → 發展中
!mature N → 發展中 → 永久筆記
!export N → 永久筆記 → 匯出到 Obsidian

【操作】查詢後用編號操作
!detail N → 查看第 N 筆詳情
!due N 日期 → 設定到期日
!tag N 標籤 → 加標籤
!untag N 標籤 → 移除標籤
!done N → 待辦標記為已完成
!archive N → 封存
!priority N high/medium/low/none → 設定優先度
!track N [日期] → 從筆記建立追蹤待辦

日期格式：明天、3天後、下週一、3/15、2026-03-15
清除到期日：!due N 清除

輸入 ? 顯示此說明`;
