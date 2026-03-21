import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { updateItem, getItem, getTags } from "@/lib/api";
import { parseItem, type ParsedItem } from "@/lib/types";
import { useAppContext } from "@/lib/app-context";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { useInvalidateAfterItemMutation } from "@/hooks/use-invalidate";

export function useItemForm(itemId: string) {
  const queryClient = useQueryClient();
  const invalidateAfterSave = useInvalidateAfterItemMutation();
  const { isOnline } = useAppContext();
  const [item, setItem] = useState<ParsedItem | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const {
    data: serverItem,
    isLoading,
    error: itemError,
  } = useQuery({
    queryKey: queryKeys.items.detail(itemId),
    queryFn: () => getItem(itemId).then(parseItem),
    refetchOnWindowFocus: !isDirty,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => getTags().then((r) => r.tags),
  });

  // Show error toast on fetch failure
  useEffect(() => {
    if (itemError) {
      toast.error(itemError instanceof Error ? itemError.message : "載入失敗");
    }
  }, [itemError]);

  // Reset dirty state when switching items
  useEffect(() => {
    setIsDirty(false);
    setItem(null);
  }, [itemId]);

  // Sync server data to local state only when not dirty
  useEffect(() => {
    if (serverItem && !isDirty) setItem(serverItem);
  }, [serverItem, isDirty]);

  // Auto-mark viewed_at when opening an unviewed item
  const markedViewedRef = useRef<string | null>(null);

  useEffect(() => {
    if (serverItem && serverItem.viewed_at === null && markedViewedRef.current !== serverItem.id) {
      markedViewedRef.current = serverItem.id;
      updateItem(serverItem.id, { viewed_at: new Date().toISOString() })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.unreviewed });
        })
        .catch(() => {
          // Silently ignore — viewed_at is best-effort
        });
    }
  }, [serverItem, queryClient]);

  const saveField = useCallback(
    async (field: string, value: unknown) => {
      if (!item) return;
      if (!isOnline) {
        toast.error("離線中，無法儲存變更");
        return;
      }
      setSaveStatus("saving");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      try {
        const updated = await updateItem(item.id, { [field]: value });
        const serverModified = updated.modified;
        setItem((prev) => (prev ? { ...prev, modified: serverModified } : prev));
        if (!saveTimeoutRef.current) {
          setIsDirty(false);
        }
        invalidateAfterSave(field);
        setSaveStatus("saved");
        savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (err) {
        setSaveStatus("idle");
        toast.error(err instanceof Error ? err.message : "儲存失敗");
      }
    },
    [item, isOnline, invalidateAfterSave],
  );

  const debouncedSave = useCallback(
    (field: string, value: unknown) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => saveField(field, value), 1500);
    },
    [saveField],
  );

  const flushSave = useCallback(
    (field: string, value: unknown) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveField(field, value);
      }
    },
    [saveField],
  );

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const addTag = useCallback(
    (tag: string) => {
      if (!item) return;
      const newTags = [...item.tags, tag];
      setItem({ ...item, tags: newTags });
      saveField("tags", newTags);
    },
    [item, saveField],
  );

  const removeTag = useCallback(
    (tag: string) => {
      if (!item) return;
      const newTags = item.tags.filter((t) => t !== tag);
      setItem({ ...item, tags: newTags });
      saveField("tags", newTags);
    },
    [item, saveField],
  );

  const addAlias = useCallback(
    (alias: string): boolean => {
      if (!item) return false;
      const trimmed = alias.trim();
      if (!trimmed || item.aliases.includes(trimmed)) return false;
      const newAliases = [...item.aliases, trimmed];
      setItem({ ...item, aliases: newAliases });
      saveField("aliases", newAliases);
      return true;
    },
    [item, saveField],
  );

  const removeAlias = useCallback(
    (alias: string) => {
      if (!item) return;
      const newAliases = item.aliases.filter((a) => a !== alias);
      setItem({ ...item, aliases: newAliases });
      saveField("aliases", newAliases);
    },
    [item, saveField],
  );

  return {
    item,
    setItem,
    isLoading,
    itemError,
    isDirty,
    setIsDirty,
    saveStatus,
    allTags,
    saveField,
    debouncedSave,
    flushSave,
    addTag,
    removeTag,
    addAlias,
    removeAlias,
    invalidateAfterSave,
  };
}
