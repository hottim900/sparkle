import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { getDashboardWeek } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { WeekDay, WeekTodoItem, WeekNoteItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  Circle,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// --- Helpers ---

const DAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"];

/** Get Monday of the week containing today (ISO week). */
function getMonday(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

/** Shift a Monday string by N weeks. */
function shiftWeek(monday: string, weeks: number): string {
  const [y, m, d] = monday.split("-").map(Number);
  const date = new Date(y!, m! - 1, d! + weeks * 7);
  return toDateStr(date);
}

/** Format Date to YYYY-MM-DD. */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Get today's local date string. */
function getToday(): string {
  return toDateStr(new Date());
}

/** Format date for display: "3/24" */
function formatShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

/** Format month header: "2026年3月" */
function formatMonthHeader(monday: string): string {
  const [y, m] = monday.split("-").map(Number);
  // If the week spans two months, show both
  const [, , d] = monday.split("-").map(Number);
  const sundayDate = new Date(y!, m! - 1, d! + 6);
  const sundayMonth = sundayDate.getMonth() + 1;
  const sundayYear = sundayDate.getFullYear();
  if (sundayYear !== y) {
    return `${y}年${m}月—${sundayYear}年${sundayMonth}月`;
  }
  if (sundayMonth !== m) {
    return `${y}年${m}月—${sundayMonth}月`;
  }
  return `${y}年${m}月`;
}

/** Build ARIA label for a day cell. */
function buildAriaLabel(day: WeekDay): string {
  const [, m, d] = day.date.split("-").map(Number);
  const parts: string[] = [`${m}月${d}日`];
  const todoCount = day.todos_due.length;
  const noteCount = day.notes_created.length + day.notes_modified.length;
  if (todoCount > 0) parts.push(`${todoCount}個待辦`);
  if (noteCount > 0) parts.push(`${noteCount}個筆記`);
  if (day.overdue_count > 0) parts.push(`${day.overdue_count}個逾期`);
  if (todoCount === 0 && noteCount === 0 && day.overdue_count === 0) parts.push("無活動");
  return parts.join("，");
}

// --- Priority display ---

function priorityColor(priority: string | null): string {
  switch (priority) {
    case "high":
      return "text-red-600 dark:text-red-400";
    case "medium":
      return "text-amber-600 dark:text-amber-400";
    case "low":
      return "text-blue-600 dark:text-blue-400";
    default:
      return "text-muted-foreground";
  }
}

function priorityLabel(priority: string | null): string | null {
  switch (priority) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return null;
  }
}

// --- Status display for notes ---

function noteStatusLabel(status: string): string {
  switch (status) {
    case "fleeting":
      return "閃念";
    case "developing":
      return "發展中";
    case "permanent":
      return "永久";
    case "exported":
      return "已匯出";
    default:
      return status;
  }
}

function noteStatusColor(status: string): string {
  switch (status) {
    case "fleeting":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
    case "developing":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "permanent":
      return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "exported":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// --- DayDetail Component ---

const MAX_ITEMS = 10;

function DayDetail({
  day,
  onItemClick,
}: {
  day: WeekDay;
  onItemClick: (id: string, type: "todo" | "note", status: string) => void;
}) {
  const todos = day.todos_due;
  const notesCreated = day.notes_created;
  const notesModified = day.notes_modified;
  const hasTodos = todos.length > 0;
  const hasNotes = notesCreated.length > 0 || notesModified.length > 0;

  if (!hasTodos && !hasNotes) {
    return <p className="text-sm text-muted-foreground py-4 text-center">這天沒有活動</p>;
  }

  return (
    <div className="space-y-3">
      {/* Todos section */}
      {hasTodos && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            待辦 ({todos.length})
          </h4>
          <div className="space-y-0.5">
            {todos.slice(0, MAX_ITEMS).map((todo: WeekTodoItem) => (
              <button
                key={todo.id}
                className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                onClick={() => onItemClick(todo.id, "todo", todo.status)}
              >
                <Circle
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    todo.status === "done" ? "text-muted-foreground" : "text-foreground",
                  )}
                  fill={todo.status === "done" ? "currentColor" : "none"}
                />
                <span
                  className={cn(
                    "truncate flex-1",
                    todo.status === "done" && "line-through text-muted-foreground",
                  )}
                >
                  {todo.title}
                </span>
                {priorityLabel(todo.priority) && (
                  <Badge
                    variant="outline"
                    className={cn("text-xs shrink-0", priorityColor(todo.priority))}
                  >
                    {priorityLabel(todo.priority)}
                  </Badge>
                )}
              </button>
            ))}
            {todos.length > MAX_ITEMS && (
              <p className="text-xs text-muted-foreground text-center py-1">
                還有 {todos.length - MAX_ITEMS} 個待辦
              </p>
            )}
          </div>
        </div>
      )}

      {/* Notes section */}
      {hasNotes && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
            <FileText className="h-3 w-3" />
            筆記 ({notesCreated.length + notesModified.length})
          </h4>
          <div className="space-y-0.5">
            {notesCreated.slice(0, MAX_ITEMS).map((note: WeekNoteItem) => (
              <button
                key={`created-${note.id}`}
                className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                onClick={() => onItemClick(note.id, "note", note.status)}
              >
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded shrink-0",
                    noteStatusColor(note.status),
                  )}
                >
                  {noteStatusLabel(note.status)}
                </span>
                <span className="truncate flex-1">{note.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">新增</span>
              </button>
            ))}
            {notesCreated.length > MAX_ITEMS && (
              <p className="text-xs text-muted-foreground text-center py-1">
                還有 {notesCreated.length - MAX_ITEMS} 個筆記
              </p>
            )}
            {notesModified.slice(0, MAX_ITEMS).map((note: WeekNoteItem) => (
              <button
                key={`modified-${note.id}`}
                className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                onClick={() => onItemClick(note.id, "note", note.status)}
              >
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded shrink-0",
                    noteStatusColor(note.status),
                  )}
                >
                  {noteStatusLabel(note.status)}
                </span>
                <span className="truncate flex-1">{note.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">修改</span>
              </button>
            ))}
            {notesModified.length > MAX_ITEMS && (
              <p className="text-xs text-muted-foreground text-center py-1">
                還有 {notesModified.length - MAX_ITEMS} 個筆記
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Activity Dots ---

function ActivityDots({ day }: { day: WeekDay }) {
  const todoCount = day.todos_due.length;
  const noteCount = day.notes_created.length + day.notes_modified.length;
  const hasOverdue = day.overdue_count > 0;

  if (todoCount === 0 && noteCount === 0 && !hasOverdue) return null;

  return (
    <div className="flex items-center justify-center gap-0.5 mt-1">
      {hasOverdue && (
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" title={`${day.overdue_count} 逾期`} />
      )}
      {todoCount > 0 && (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title={`${todoCount} 待辦`} />
      )}
      {noteCount > 0 && (
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" title={`${noteCount} 筆記`} />
      )}
    </div>
  );
}

// --- Main WeekView Component ---

export function WeekView() {
  const navigate = useNavigate();
  const today = getToday();
  const [startDate, setStartDate] = useState(() => getMonday(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // #228: Track pending focus date for cross-week keyboard navigation
  const [pendingFocusDate, setPendingFocusDate] = useState<string | null>(null);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.dashboardWeek(startDate),
    queryFn: () => getDashboardWeek(startDate),
  });

  // #231: Use ID-based dedup to prevent duplicate toasts on remount
  useEffect(() => {
    if (error) toast.error("無法載入週檢視資料", { id: "weekview-fetch-error" });
  }, [error]);

  // #228: Focus the pending date cell after cross-week navigation renders new data
  useEffect(() => {
    if (pendingFocusDate && data?.days) {
      const el = cellRefs.current.get(pendingFocusDate);
      if (el) {
        el.focus();
        setPendingFocusDate(null);
      }
    }
  }, [pendingFocusDate, data]);

  // #230: Clean up stale cellRefs entries when data changes
  useEffect(() => {
    if (data?.days) {
      const validDates = new Set(data.days.map((d) => d.date));
      for (const key of cellRefs.current.keys()) {
        if (!validDates.has(key)) {
          cellRefs.current.delete(key);
        }
      }
    }
  }, [data]);

  const goToPrevWeek = useCallback(() => {
    setStartDate((s) => shiftWeek(s, -1));
    setSelectedDay(null);
  }, []);

  const goToNextWeek = useCallback(() => {
    setStartDate((s) => shiftWeek(s, 1));
    setSelectedDay(null);
  }, []);

  const goToThisWeek = useCallback(() => {
    setStartDate(getMonday(new Date()));
    setSelectedDay(null);
  }, []);

  const toggleDay = useCallback((date: string) => {
    setSelectedDay((prev) => (prev === date ? null : date));
  }, []);

  const handleItemClick = useCallback(
    (id: string, type: "todo" | "note", status: string) => {
      let to: string;
      if (type === "todo") {
        to = status === "done" ? "/todos/done" : "/todos";
      } else {
        to = `/notes/${status}`;
      }
      navigate({ to, search: { item: id } });
    },
    [navigate],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, dayDate: string, dayIndex: number) => {
      const days = data?.days;
      if (!days) return;

      let targetIndex: number | null = null;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        targetIndex = dayIndex > 0 ? dayIndex - 1 : null;
        if (targetIndex === null) {
          // #228: Go to previous week, focus Sunday after data renders
          setStartDate((s) => {
            const prevMonday = shiftWeek(s, -1);
            const [y, m, d] = prevMonday.split("-").map(Number);
            const sunday = new Date(y!, m! - 1, d! + 6);
            setPendingFocusDate(toDateStr(sunday));
            return prevMonday;
          });
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        targetIndex = dayIndex < 6 ? dayIndex + 1 : null;
        if (targetIndex === null) {
          // #228: Go to next week, focus Monday after data renders
          setStartDate((s) => {
            const nextMonday = shiftWeek(s, 1);
            setPendingFocusDate(nextMonday);
            return nextMonday;
          });
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleDay(dayDate);
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedDay(null);
        return;
      }

      if (targetIndex !== null && days[targetIndex]) {
        const targetDate = days[targetIndex]!.date;
        const el = cellRefs.current.get(targetDate);
        if (el) el.focus();
      }
    },
    [data, toggleDay],
  );

  const isThisWeek = startDate === getMonday(new Date());
  const selectedDayData = data?.days.find((d) => d.date === selectedDay);

  return (
    <section className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground">週檢視</h2>
        </div>
        <div className="flex items-center gap-1">
          {!isThisWeek && (
            <Button variant="ghost" size="xs" onClick={goToThisWeek} className="text-xs">
              本週
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={goToPrevWeek} aria-label="上一週">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[90px] text-center">
            {formatMonthHeader(startDate)}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={goToNextWeek} aria-label="下一週">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Week Strip */}
      {isLoading ? (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="border rounded-lg p-4 text-center space-y-2">
          <p className="text-sm text-muted-foreground">載入失敗</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3 mr-1" />
            重試
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1" role="grid" aria-label="週檢視">
            {data?.days.map((day, i) => {
              const isToday = day.date === today;
              const isSelected = day.date === selectedDay;
              const hasOverdue = day.overdue_count > 0;

              return (
                <button
                  key={day.date}
                  ref={(el) => {
                    if (el) cellRefs.current.set(day.date, el);
                  }}
                  role="gridcell"
                  aria-label={buildAriaLabel(day)}
                  aria-selected={isSelected}
                  tabIndex={i === 0 ? 0 : -1}
                  className={cn(
                    "relative flex flex-col items-center rounded-md py-1.5 px-1 min-h-[56px] transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                    isSelected ? "bg-accent ring-1 ring-ring" : "hover:bg-accent/50",
                    isToday && "ring-1 ring-primary",
                  )}
                  onClick={() => toggleDay(day.date)}
                  onKeyDown={(e) => handleKeyDown(e, day.date, i)}
                >
                  {/* Day name */}
                  <span className="text-[10px] text-muted-foreground leading-none">
                    {DAY_NAMES[i]}
                  </span>

                  {/* Date number */}
                  <span
                    className={cn(
                      "text-sm font-medium mt-0.5 leading-none",
                      isToday && "text-primary font-bold",
                    )}
                  >
                    {formatShortDate(day.date)}
                  </span>

                  {/* Activity dots */}
                  <ActivityDots day={day} />

                  {/* Overdue badge */}
                  {hasOverdue && (
                    <span
                      className="absolute -top-1 -right-1 flex items-center justify-center h-4 min-w-[16px] px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold"
                      title={`${day.overdue_count} 逾期`}
                    >
                      <AlertTriangle className="h-2.5 w-2.5 mr-px" />
                      {day.overdue_count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Day Detail (inline expansion) */}
          {selectedDay && selectedDayData && (
            <div className="border rounded-lg p-3 animate-in slide-in-from-top-2 duration-200">
              <DayDetail day={selectedDayData} onItemClick={handleItemClick} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
