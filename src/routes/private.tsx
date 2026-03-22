import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { PrivateOverlay } from "@/components/private-overlay";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PinInput } from "@/components/pin-input";
import { ErrorBoundary } from "@/components/error-boundary";
import { TagInput } from "@/components/tag-input";
import { queryKeys } from "@/lib/query-keys";
import { parseItem, parseItems, type ParsedItem, type ItemStatus } from "@/lib/types";
import {
  getPrivateStatus,
  setupPin,
  unlockPrivate,
  listPrivateItems,
  getPrivateItem,
  createPrivateItem,
  updatePrivateItem,
  deletePrivateItem,
  getPrivateTags,
  changePin,
} from "@/lib/private-api";
import { toast } from "sonner";
import {
  Lock,
  Plus,
  ArrowLeft,
  Trash2,
  Loader2,
  Check,
  Inbox,
  FileText,
  ListTodo,
  Eye,
  Pencil,
  KeyRound,
  LockOpen,
  ChevronUp,
  AlertCircle,
} from "lucide-react";

const MarkdownPreview = lazy(() =>
  import("@/components/markdown-preview").then((m) => ({ default: m.MarkdownPreview })),
);

// --- PIN Setup View ---

function PinSetupView({ onSetupComplete }: { onSetupComplete: (token: string) => void }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isValid = pin.length >= 6 && pin.length <= 12;
  const isMatch = pin === confirmPin;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      setError("PIN 必須為 6-12 位數字");
      return;
    }
    if (!isMatch) {
      setError("兩次輸入的 PIN 不一致");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await setupPin(pin);
      const { token } = await unlockPrivate(pin);
      onSetupComplete(token);
      toast.success("私密空間已設定完成");
    } catch (err) {
      setError(err instanceof Error ? err.message : "設定失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div className="space-y-2">
          <Lock className="h-10 w-10 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">設定私密空間</h1>
          <p className="text-sm text-muted-foreground">設定 PIN 碼以保護您的私密筆記</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">PIN 碼</label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={12}
              minLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="6-12 位數字"
              className="text-center text-lg tracking-widest h-12"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">確認 PIN 碼</label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={12}
              minLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              placeholder="再次輸入 PIN 碼"
              className="text-center text-lg tracking-widest h-12"
              autoComplete="off"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full h-10" disabled={!isValid || !isMatch || loading}>
            {loading ? "設定中..." : "設定 PIN 碼"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// --- PIN Unlock View ---

function PinUnlockView({ onUnlocked }: { onUnlocked: (token: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (pin: string) => {
    setError(null);
    setLoading(true);
    try {
      const { token } = await unlockPrivate(pin);
      onUnlocked(token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "解鎖失敗";
      if (msg.includes("rate") || msg.includes("too many") || msg.includes("429")) {
        setError("嘗試次數過多，請稍後再試");
      } else {
        setError("PIN 錯誤");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div className="space-y-2">
          <Lock className="h-10 w-10 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">私密空間</h1>
          <p className="text-sm text-muted-foreground">輸入 PIN 碼以解鎖</p>
        </div>
        <PinInput
          onSubmit={handleSubmit}
          error={error}
          loading={loading}
          label="PIN 碼"
          buttonText="解鎖"
        />
      </div>
    </div>
  );
}

// --- Change PIN Dialog ---

function ChangePinDialog({
  token,
  open,
  onOpenChange,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setOldPin("");
    setNewPin("");
    setConfirmPin("");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length < 6 || newPin.length > 12) {
      setError("新 PIN 碼必須為 6-12 位數字");
      return;
    }
    if (newPin !== confirmPin) {
      setError("兩次輸入的新 PIN 碼不一致");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await changePin(token, oldPin, newPin);
      toast.success("PIN 碼已變更");
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "變更失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>變更 PIN 碼</DialogTitle>
          <DialogDescription>輸入舊 PIN 碼和新 PIN 碼</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">舊 PIN 碼</label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={12}
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ""))}
              placeholder="輸入舊 PIN 碼"
              className="text-center tracking-widest"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">新 PIN 碼</label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={12}
              minLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              placeholder="6-12 位數字"
              className="text-center tracking-widest"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">確認新 PIN 碼</label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={12}
              minLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              placeholder="再次輸入新 PIN 碼"
              className="text-center tracking-widest"
              autoComplete="off"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "變更中..." : "確認變更"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Private Item Detail ---

const noteStatuses: { value: ItemStatus; label: string }[] = [
  { value: "fleeting", label: "閃念" },
  { value: "developing", label: "發展中" },
  { value: "permanent", label: "永久筆記" },
  { value: "archived", label: "已封存" },
];

const todoStatuses: { value: ItemStatus; label: string }[] = [
  { value: "active", label: "進行中" },
  { value: "done", label: "已完成" },
  { value: "archived", label: "已封存" },
];

function PrivateItemDetail({
  token,
  itemId,
  onBack,
  onDeleted,
}: {
  token: string;
  itemId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [localItem, setLocalItem] = useState<ParsedItem | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [previewMode, setPreviewMode] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { data: serverItem, isLoading } = useQuery({
    queryKey: queryKeys.private.detail(itemId),
    queryFn: () => getPrivateItem(token, itemId).then(parseItem),
    refetchOnWindowFocus: !isDirty,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: queryKeys.private.tags,
    queryFn: () => getPrivateTags(token),
  });

  // Reset on item switch
  useEffect(() => {
    setIsDirty(false);
    setLocalItem(null);
    setPreviewMode(false);
    setSaveStatus("idle");
  }, [itemId]);

  // Sync server to local
  useEffect(() => {
    if (serverItem && !isDirty) setLocalItem(serverItem);
  }, [serverItem, isDirty]);

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const saveField = useCallback(
    async (field: string, value: unknown) => {
      if (!localItem) return;
      setSaveStatus("saving");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      try {
        const updated = await updatePrivateItem(token, localItem.id, { [field]: value });
        const serverModified = updated.modified;
        setLocalItem((prev) => (prev ? { ...prev, modified: serverModified } : prev));
        if (!saveTimeoutRef.current) {
          setIsDirty(false);
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.private.list() });
        queryClient.invalidateQueries({ queryKey: queryKeys.private.detail(localItem.id) });
        setSaveStatus("saved");
        savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (err) {
        setSaveStatus("idle");
        toast.error(err instanceof Error ? err.message : "儲存失敗");
      }
    },
    [localItem, token, queryClient],
  );

  const debouncedSave = useCallback(
    (field: string, value: unknown) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = undefined;
        saveField(field, value);
      }, 1500);
    },
    [saveField],
  );

  const flushSave = useCallback(
    (field: string, value: unknown) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = undefined;
        saveField(field, value);
      }
    },
    [saveField],
  );

  const addTag = useCallback(
    (tag: string) => {
      if (!localItem) return;
      const newTags = [...localItem.tags, tag];
      setLocalItem({ ...localItem, tags: newTags });
      saveField("tags", newTags);
    },
    [localItem, saveField],
  );

  const removeTag = useCallback(
    (tag: string) => {
      if (!localItem) return;
      const newTags = localItem.tags.filter((t) => t !== tag);
      setLocalItem({ ...localItem, tags: newTags });
      saveField("tags", newTags);
    },
    [localItem, saveField],
  );

  const handleDelete = async () => {
    if (!localItem) return;
    try {
      await deletePrivateItem(token, localItem.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.private.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.private.tags });
      toast.success("已刪除");
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    }
  };

  const handleMakePublic = async () => {
    if (!localItem) return;
    try {
      await updatePrivateItem(token, localItem.id, { is_private: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.private.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.private.tags });
      // Also invalidate main items so it appears there
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
      toast.success("已解除私密");
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "解除私密失敗");
    }
  };

  const handleAdvance = async () => {
    if (!localItem || localItem.type !== "note") return;
    const nextStatus =
      localItem.status === "fleeting"
        ? "developing"
        : localItem.status === "developing"
          ? "permanent"
          : null;
    if (!nextStatus) return;
    try {
      await updatePrivateItem(token, localItem.id, { status: nextStatus });
      setLocalItem((prev) => (prev ? { ...prev, status: nextStatus as ItemStatus } : prev));
      queryClient.invalidateQueries({ queryKey: queryKeys.private.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.private.detail(localItem.id) });
      toast.success(`已推進至「${nextStatus === "developing" ? "發展中" : "永久筆記"}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "推進失敗");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!localItem) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">找不到項目</p>
      </div>
    );
  }

  const statusOptions = localItem.type === "note" ? noteStatuses : todoStatuses;
  const canAdvance =
    localItem.type === "note" &&
    (localItem.status === "fleeting" || localItem.status === "developing");

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1">
          {saveStatus === "saving" && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              儲存中...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Check className="h-3 w-3" />
              已儲存
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canAdvance && (
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={handleAdvance}>
              <ChevronUp className="h-3 w-3" />
              推進
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={handleMakePublic}>
            <LockOpen className="h-3 w-3" />
            解除私密
          </Button>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="刪除"
              title="刪除"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>確認刪除</DialogTitle>
                <DialogDescription>
                  確定要刪除「{localItem.title}」嗎？此操作無法復原。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                  取消
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    handleDelete();
                    setDeleteOpen(false);
                  }}
                >
                  刪除
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Type indicator bar */}
      <div
        className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium ${
          localItem.type === "note"
            ? "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
            : "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
        }`}
      >
        {localItem.type === "note" ? (
          <FileText className="h-3.5 w-3.5" />
        ) : (
          <ListTodo className="h-3.5 w-3.5" />
        )}
        {localItem.type === "note" ? "筆記" : "待辦"}
        <Lock className="h-3 w-3 ml-1" />
        <span>私密</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 break-words">
        {/* Title */}
        <Input
          value={localItem.title}
          onChange={(e) => {
            setIsDirty(true);
            setLocalItem({ ...localItem, title: e.target.value });
            debouncedSave("title", e.target.value);
          }}
          onBlur={() => flushSave("title", localItem.title)}
          className="text-lg font-semibold border-0 px-0 focus-visible:ring-0"
          placeholder="標題"
        />

        {/* Metadata */}
        <div className="text-xs text-muted-foreground font-mono">
          <button
            type="button"
            className="hover:text-foreground transition-colors cursor-pointer"
            title="點擊複製完整 ID"
            onClick={() => {
              navigator.clipboard.writeText(localItem.id);
              toast.success("已複製 ID");
            }}
          >
            {localItem.id.split("-")[0]}
          </button>
          {" · "}建立 {new Date(localItem.created).toLocaleString("zh-TW")} · 更新{" "}
          {new Date(localItem.modified).toLocaleString("zh-TW")}
        </div>

        {/* Status */}
        <div className="flex gap-2 flex-wrap">
          <Select
            value={localItem.status}
            onValueChange={(v) => {
              setLocalItem({ ...localItem, status: v as ItemStatus });
              saveField("status", v);
            }}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={localItem.priority ?? "none"}
            onValueChange={(v) => {
              const val = v === "none" ? null : v;
              setLocalItem({
                ...localItem,
                priority: val as ParsedItem["priority"],
              });
              saveField("priority", val);
            }}
          >
            <SelectTrigger className="w-24">
              <SelectValue placeholder="優先度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">無</SelectItem>
              <SelectItem value="low">低</SelectItem>
              <SelectItem value="medium">中</SelectItem>
              <SelectItem value="high">高</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Due date (todo only) */}
        {localItem.type === "todo" && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">到期日</label>
            <Input
              type="date"
              value={localItem.due ?? ""}
              onChange={(e) => {
                const val = e.target.value || null;
                setLocalItem({ ...localItem, due: val });
                saveField("due", val);
              }}
            />
          </div>
        )}

        {/* Source URL */}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">參考連結</label>
          <Input
            type="url"
            value={localItem.source ?? ""}
            onChange={(e) => {
              const val = e.target.value || null;
              setIsDirty(true);
              setLocalItem({ ...localItem, source: val });
              debouncedSave("source", val);
            }}
            onBlur={() => flushSave("source", localItem.source)}
            placeholder="https://..."
          />
        </div>

        {/* Tags */}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">標籤</label>
          <TagInput tags={localItem.tags} allTags={allTags} onAdd={addTag} onRemove={removeTag} />
        </div>

        {/* Content / Markdown */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-muted-foreground">內容</label>
            <div className="flex gap-1">
              <Button
                variant={previewMode ? "ghost" : "secondary"}
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setPreviewMode(false)}
              >
                <Pencil className="h-3 w-3" />
                編輯
              </Button>
              <Button
                variant={previewMode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setPreviewMode(true)}
              >
                <Eye className="h-3 w-3" />
                預覽
              </Button>
            </div>
          </div>
          {previewMode ? (
            <div className="min-h-[240px] rounded-md border p-3 text-sm break-words">
              {localItem.content ? (
                <ErrorBoundary>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    }
                  >
                    <MarkdownPreview content={localItem.content} />
                  </Suspense>
                </ErrorBoundary>
              ) : (
                <p className="text-muted-foreground">無內容</p>
              )}
            </div>
          ) : (
            <Textarea
              value={localItem.content}
              onChange={(e) => {
                setIsDirty(true);
                setLocalItem({ ...localItem, content: e.target.value });
                debouncedSave("content", e.target.value);
              }}
              onBlur={() => flushSave("content", localItem.content)}
              placeholder="Markdown 內容..."
              rows={10}
              className="font-mono text-sm"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// --- Private Item Card ---

const priorityColors: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-500",
};

function PrivateItemCard({
  item,
  selected,
  onSelect,
}: {
  item: ParsedItem;
  selected?: boolean;
  onSelect: (item: ParsedItem) => void;
}) {
  const borderColor = item.priority ? (priorityColors[item.priority] ?? "") : "";

  return (
    <div
      className={`p-3 border-l-4 cursor-pointer transition-colors hover:bg-accent ${borderColor} ${
        selected ? "bg-accent" : ""
      } ${item.status === "done" ? "opacity-60" : ""}`}
      onClick={() => onSelect(item)}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-medium truncate ${
              item.status === "done" ? "line-through" : ""
            }`}
          >
            {item.title}
          </p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {item.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground">
              {item.type === "note" ? (
                <FileText className="inline h-3 w-3 mr-0.5" />
              ) : (
                <ListTodo className="inline h-3 w-3 mr-0.5" />
              )}
              {item.type === "note" ? "筆記" : "待辦"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Private Items List ---

function PrivateItemsList({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "note" | "todo">("all");
  const [changePinOpen, setChangePinOpen] = useState(false);

  const filterParams: Record<string, string> | undefined =
    typeFilter !== "all" ? { type: typeFilter } : undefined;

  const {
    data,
    isPending,
    error: listError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.private.list(filterParams),
    queryFn: () => listPrivateItems(token, filterParams),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => createPrivateItem(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.private.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.private.tags });
      toast.success("已新增私密項目");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "新增失敗");
    },
  });

  const items = data ? parseItems(data.items) : [];

  const handleCreate = () => {
    const type = typeFilter === "all" ? "note" : typeFilter;
    createMutation.mutate({
      title: "未命名",
      type,
      origin: "app",
    });
  };

  const handleItemDeleted = () => {
    setSelectedId(null);
  };

  // If an item is selected, show detail view (mobile: full screen, desktop: split)
  if (selectedId) {
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* List panel — hidden on mobile when item selected */}
        <div className="hidden md:flex md:w-96 md:flex-none md:border-r flex-col min-h-0 overflow-hidden">
          <ListHeader
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            onCreate={handleCreate}
            creating={createMutation.isPending}
            onChangePinOpen={() => setChangePinOpen(true)}
          />
          <div className="flex-1 overflow-y-auto divide-y">
            {items.map((item) => (
              <PrivateItemCard
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={(i) => setSelectedId(i.id)}
              />
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="fixed inset-0 z-50 bg-background md:static md:z-auto md:flex-1 md:min-w-0 md:border-l">
          <PrivateItemDetail
            token={token}
            itemId={selectedId}
            onBack={() => setSelectedId(null)}
            onDeleted={handleItemDeleted}
          />
        </div>

        <ChangePinDialog token={token} open={changePinOpen} onOpenChange={setChangePinOpen} />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <ListHeader
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        onCreate={handleCreate}
        creating={createMutation.isPending}
        onChangePinOpen={() => setChangePinOpen(true)}
      />

      <div className="flex-1 overflow-y-auto">
        {isPending ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : listError ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <AlertCircle className="h-10 w-10 mb-2" />
            <p className="text-sm">載入失敗</p>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="mt-2">
              重試
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Inbox className="h-10 w-10 mb-2" />
            <p className="text-sm">沒有私密項目</p>
            <p className="text-xs mt-1">點擊「新增」建立第一個私密筆記</p>
          </div>
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <PrivateItemCard key={item.id} item={item} onSelect={(i) => setSelectedId(i.id)} />
            ))}
          </div>
        )}
      </div>

      <ChangePinDialog token={token} open={changePinOpen} onOpenChange={setChangePinOpen} />
    </div>
  );
}

// --- List Header ---

function ListHeader({
  typeFilter,
  onTypeFilterChange,
  onCreate,
  creating,
  onChangePinOpen,
}: {
  typeFilter: "all" | "note" | "todo";
  onTypeFilterChange: (filter: "all" | "note" | "todo") => void;
  onCreate: () => void;
  creating: boolean;
  onChangePinOpen: () => void;
}) {
  return (
    <div className="border-b bg-card">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h1 className="font-semibold">私密空間</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onChangePinOpen}
            aria-label="變更 PIN 碼"
            title="變更 PIN 碼"
          >
            <KeyRound className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" className="gap-1" onClick={onCreate} disabled={creating}>
            <Plus className="h-3.5 w-3.5" />
            新增
          </Button>
        </div>
      </div>
      <div className="flex px-3 pb-2 gap-1">
        {(["all", "note", "todo"] as const).map((filter) => (
          <Button
            key={filter}
            size="sm"
            variant={typeFilter === filter ? "default" : "ghost"}
            className="h-7 text-xs"
            onClick={() => onTypeFilterChange(filter)}
          >
            {filter === "all" ? "全部" : filter === "note" ? "筆記" : "待辦"}
          </Button>
        ))}
      </div>
    </div>
  );
}

// --- Main Private Page ---

function PrivatePage() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: queryKeys.private.status,
    queryFn: getPrivateStatus,
  });

  // Lock helper: fires lock API and clears token. Uses ref to prevent double-lock.
  const lockedRef = useRef(false);
  useEffect(() => {
    if (sessionToken) lockedRef.current = false;
  }, [sessionToken]);

  const fireLock = useCallback((tokenToLock: string) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    const authToken = localStorage.getItem("auth_token");
    fetch("/api/private/lock", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "X-Private-Token": tokenToLock,
      },
      keepalive: true,
    });
  }, []);

  // visibilitychange: lock when page becomes hidden (before OS screenshot)
  useEffect(() => {
    if (!sessionToken) return;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        setOverlayVisible(true); // Sync render before OS takes screenshot
        fireLock(sessionToken);
        setSessionToken(null);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [sessionToken, fireLock]);

  // Route leave: lock on unmount (navigation away from /private)
  useEffect(() => {
    if (!sessionToken) return;
    return () => {
      fireLock(sessionToken);
    };
  }, [sessionToken, fireLock]);

  const content = (() => {
    if (statusLoading) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    // State 3 first: if we have a token, go straight to unlocked (covers post-setup)
    if (sessionToken) {
      return <PrivateItemsList token={sessionToken} />;
    }

    // State 1: Not configured
    if (status && !status.configured) {
      return <PinSetupView onSetupComplete={setSessionToken} />;
    }

    // State 2: Locked (configured but no token)
    return (
      <PinUnlockView
        onUnlocked={(token) => {
          setOverlayVisible(false);
          setSessionToken(token);
        }}
      />
    );
  })();

  return (
    <>
      {content}
      <PrivateOverlay visible={overlayVisible} />
    </>
  );
}

export const Route = createFileRoute("/private")({
  component: PrivatePage,
});
