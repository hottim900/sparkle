import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { updateItem, getItem, getTags } from "@/lib/api";
import { parseItem, type ParsedItem } from "@/lib/types";
import { useAppContext } from "@/lib/app-context";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { useInvalidateAfterItemMutation } from "@/hooks/use-invalidate";

export interface UseItemFormOptions {
  /**
   * When true, saveField("is_private", ...) will additionally
   * invalidate private-related query keys.
   */
  enablePrivateToggle?: boolean;
}

interface PendingFieldSave {
  field: string;
  value: unknown;
  generation: number;
  phase: "composing" | "scheduled" | "in-flight" | "failed";
  saveOnCompositionAbandon?: boolean;
  timeout?: ReturnType<typeof setTimeout>;
}

type SaveField = (
  field: string,
  value: unknown,
  pendingGeneration?: number,
  ownerItemId?: string,
) => Promise<void>;

export function useItemForm(itemId: string, options: UseItemFormOptions = {}) {
  const { enablePrivateToggle = false } = options;
  const queryClient = useQueryClient();
  const invalidateAfterSave = useInvalidateAfterItemMutation();
  const { isOnline } = useAppContext();
  const [item, setItem] = useState<ParsedItem | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editGenerationRef = useRef(0);
  const pendingSavesRef = useRef(new Map<string, Map<string, PendingFieldSave>>());
  const inFlightSaveCountRef = useRef(new Map<string, number>());
  const failedSaveBatchRef = useRef(new Set<string>());
  const autosaveInFlightRef = useRef(new Map<string, Map<string, number>>());
  const saveFieldRef = useRef<SaveField | null>(null);
  const activeItemIdRef = useRef(itemId);
  const previousItemIdRef = useRef(itemId);
  activeItemIdRef.current = itemId;

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
    const previousItemId = previousItemIdRef.current;
    previousItemIdRef.current = itemId;
    if (previousItemId !== itemId) {
      const previousPendingSaves = pendingSavesRef.current.get(previousItemId);
      for (const pendingSave of previousPendingSaves?.values() ?? []) {
        if (pendingSave.phase !== "composing") continue;
        if (!pendingSave.saveOnCompositionAbandon) {
          previousPendingSaves?.delete(pendingSave.field);
          continue;
        }
        if (autosaveInFlightRef.current.get(previousItemId)?.has(pendingSave.field)) {
          pendingSave.phase = "scheduled";
          continue;
        }
        pendingSave.phase = "in-flight";
        void saveFieldRef.current?.(
          pendingSave.field,
          pendingSave.value,
          pendingSave.generation,
          previousItemId,
        );
      }
      if (previousPendingSaves?.size === 0) {
        pendingSavesRef.current.delete(previousItemId);
      }
    }
    setIsDirty(false);
    setItem(null);
    setSaveStatus("idle");
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = undefined;
    }
  }, [itemId]);

  // Sync server data to local state only when not dirty
  useEffect(() => {
    if (!serverItem || isDirty) return;
    const pendingFields = pendingSavesRef.current.get(serverItem.id);
    if (!pendingFields?.size) {
      setItem(serverItem);
      return;
    }
    const pendingItem = { ...serverItem } as ParsedItem & Record<string, unknown>;
    for (const [field, pendingSave] of pendingFields) {
      pendingItem[field] = pendingSave.value;
    }
    setItem(pendingItem);
    setIsDirty(true);
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
    async (field: string, value: unknown, pendingGeneration?: number, ownerItemId = item?.id) => {
      if (!ownerItemId) return;
      if (item?.id === ownerItemId && item.origin === "vault") return;
      if (!isOnline) {
        const pendingSave = pendingSavesRef.current.get(ownerItemId)?.get(field);
        if (pendingGeneration !== undefined && pendingSave?.generation === pendingGeneration) {
          pendingSave.phase = "failed";
        }
        toast.error("離線中，無法儲存變更");
        return;
      }
      if (pendingGeneration !== undefined) {
        let itemInFlightFields = autosaveInFlightRef.current.get(ownerItemId);
        if (!itemInFlightFields) {
          itemInFlightFields = new Map();
          autosaveInFlightRef.current.set(ownerItemId, itemInFlightFields);
        }
        itemInFlightFields.set(field, pendingGeneration);
      }
      const previousInFlightCount = inFlightSaveCountRef.current.get(ownerItemId) ?? 0;
      if (previousInFlightCount === 0) {
        failedSaveBatchRef.current.delete(ownerItemId);
      }
      inFlightSaveCountRef.current.set(ownerItemId, previousInFlightCount + 1);
      if (activeItemIdRef.current === ownerItemId) {
        setSaveStatus("saving");
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      }
      try {
        const updated = await updateItem(ownerItemId, { [field]: value });
        const serverModified = updated.modified;
        setItem((prev) => {
          if (!prev || prev.id !== ownerItemId) return prev;
          const next = { ...prev, modified: serverModified };
          // Keep local is_private in sync after toggle
          if (field === "is_private" && typeof value === "boolean") {
            next.is_private = value ? 1 : 0;
          }
          return next;
        });
        if (
          pendingGeneration !== undefined &&
          pendingSavesRef.current.get(ownerItemId)?.get(field)?.generation === pendingGeneration
        ) {
          const itemPendingSaves = pendingSavesRef.current.get(ownerItemId);
          itemPendingSaves?.delete(field);
          if (itemPendingSaves?.size === 0) {
            pendingSavesRef.current.delete(ownerItemId);
          }
          if (activeItemIdRef.current === ownerItemId && !itemPendingSaves?.size) {
            setIsDirty(false);
          }
        }
        invalidateAfterSave(field);
        // When toggling is_private, also invalidate private-related queries
        if (field === "is_private" && enablePrivateToggle) {
          queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
          queryClient.invalidateQueries({ queryKey: queryKeys.tags });
          queryClient.invalidateQueries({ queryKey: queryKeys.stats });
        }
      } catch (err) {
        const pendingSave = pendingSavesRef.current.get(ownerItemId)?.get(field);
        const failureIsCurrent =
          pendingGeneration === undefined || pendingSave?.generation === pendingGeneration;
        if (pendingGeneration !== undefined && pendingSave && failureIsCurrent) {
          pendingSave.phase = "failed";
        }
        if (failureIsCurrent) {
          failedSaveBatchRef.current.add(ownerItemId);
        }
        if (failureIsCurrent) {
          toast.error(err instanceof Error ? err.message : "儲存失敗");
        }
      } finally {
        if (pendingGeneration !== undefined) {
          const itemInFlightFields = autosaveInFlightRef.current.get(ownerItemId);
          if (itemInFlightFields?.get(field) === pendingGeneration) {
            itemInFlightFields.delete(field);
            if (itemInFlightFields.size === 0) {
              autosaveInFlightRef.current.delete(ownerItemId);
            }
          }
        }

        const remainingInFlight = (inFlightSaveCountRef.current.get(ownerItemId) ?? 1) - 1;
        if (remainingInFlight > 0) {
          inFlightSaveCountRef.current.set(ownerItemId, remainingInFlight);
        } else {
          inFlightSaveCountRef.current.delete(ownerItemId);
        }

        if (activeItemIdRef.current === ownerItemId && remainingInFlight === 0) {
          const batchFailed = failedSaveBatchRef.current.has(ownerItemId);
          failedSaveBatchRef.current.delete(ownerItemId);
          if (batchFailed || pendingSavesRef.current.get(ownerItemId)?.size) {
            setSaveStatus("idle");
          } else {
            setSaveStatus("saved");
            savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
          }
        } else if (remainingInFlight === 0) {
          failedSaveBatchRef.current.delete(ownerItemId);
        }

        const queuedSave = pendingSavesRef.current.get(ownerItemId)?.get(field);
        if (
          pendingGeneration !== undefined &&
          queuedSave &&
          queuedSave.generation !== pendingGeneration &&
          queuedSave.phase === "scheduled" &&
          !queuedSave.timeout
        ) {
          queuedSave.phase = "in-flight";
          void saveFieldRef.current?.(field, queuedSave.value, queuedSave.generation, ownerItemId);
        }
      }
    },
    [item, isOnline, invalidateAfterSave, enablePrivateToggle, queryClient],
  );
  saveFieldRef.current = saveField;

  const debouncedSave = useCallback(
    (field: string, value: unknown) => {
      const ownerItemId = item?.id;
      if (!ownerItemId) return;
      editGenerationRef.current += 1;
      const generation = editGenerationRef.current;
      let itemPendingSaves = pendingSavesRef.current.get(ownerItemId);
      if (!itemPendingSaves) {
        itemPendingSaves = new Map();
        pendingSavesRef.current.set(ownerItemId, itemPendingSaves);
      }
      const previousPending = itemPendingSaves.get(field);
      if (previousPending?.timeout) clearTimeout(previousPending.timeout);
      const pendingSave: PendingFieldSave = {
        field,
        value,
        generation,
        phase: "scheduled",
      };
      itemPendingSaves.set(field, pendingSave);
      pendingSave.timeout = setTimeout(() => {
        const currentPending = pendingSavesRef.current.get(ownerItemId)?.get(field);
        if (currentPending?.generation === generation) {
          currentPending.timeout = undefined;
          if (autosaveInFlightRef.current.get(ownerItemId)?.has(field)) {
            return;
          }
          currentPending.phase = "in-flight";
          saveField(field, value, generation, ownerItemId);
        }
      }, 1500);
    },
    [item?.id, saveField],
  );

  const beginComposition = useCallback(
    (field: string) => {
      const ownerItemId = item?.id;
      if (!ownerItemId) return;
      let itemPendingSaves = pendingSavesRef.current.get(ownerItemId);
      if (!itemPendingSaves) {
        itemPendingSaves = new Map();
        pendingSavesRef.current.set(ownerItemId, itemPendingSaves);
      }
      const pendingSave = itemPendingSaves.get(field);
      if (pendingSave?.phase === "composing") return;
      editGenerationRef.current += 1;
      const generation = editGenerationRef.current;
      if (pendingSave?.timeout) clearTimeout(pendingSave.timeout);
      itemPendingSaves.set(field, {
        field,
        value: (item as ParsedItem & Record<string, unknown>)[field],
        generation,
        phase: "composing",
        saveOnCompositionAbandon: pendingSave !== undefined,
      });
    },
    [item],
  );

  const flushSave = useCallback(
    (field: string, _value: unknown) => {
      const ownerItemId = item?.id;
      if (!ownerItemId) return;
      const pendingSave = pendingSavesRef.current.get(ownerItemId)?.get(field);
      if (
        !pendingSave ||
        pendingSave.field !== field ||
        pendingSave.phase === "composing" ||
        pendingSave.phase === "in-flight"
      ) {
        return;
      }
      if (pendingSave.timeout) {
        clearTimeout(pendingSave.timeout);
        pendingSave.timeout = undefined;
      }
      if (autosaveInFlightRef.current.get(ownerItemId)?.has(field)) {
        return;
      }
      pendingSave.phase = "in-flight";
      saveField(field, pendingSave.value, pendingSave.generation, ownerItemId);
    },
    [item?.id, saveField],
  );

  // Cleanup timeouts on unmount
  useEffect(() => {
    const pendingSaves = pendingSavesRef.current;
    return () => {
      for (const itemPendingSaves of pendingSaves.values()) {
        for (const pendingSave of itemPendingSaves.values()) {
          if (pendingSave.timeout) clearTimeout(pendingSave.timeout);
        }
      }
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
    beginComposition,
    flushSave,
    addTag,
    removeTag,
    addAlias,
    removeAlias,
    invalidateAfterSave,
  };
}
