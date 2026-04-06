import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Check if a title appears to be auto-derived from content first line */
export function isAutoTitle(title: string, content: string | null | undefined): boolean {
  if (!content) return false;
  const lines = content.split("\n");
  const firstNonEmpty = lines.find((line) => line.trim() !== "") ?? "";
  const trimmed = firstNonEmpty.trim();
  const firstLine = trimmed.length > 80 ? trimmed.slice(0, 80) + "..." : trimmed;
  return title.trim() === firstLine;
}

interface TitleConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTitle: string;
  onConfirm: (title: string) => void;
}

export function TitleConfirmDialog({
  open,
  onOpenChange,
  currentTitle,
  onConfirm,
}: TitleConfirmDialogProps) {
  const [title, setTitle] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(currentTitle);
    }
  }, [open, currentTitle]);

  useEffect(() => {
    if (open) {
      // Focus and select all text after dialog opens
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  const handleConfirm = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>確認標題</DialogTitle>
          <DialogDescription>推進前請確認或修改標題</DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleConfirm();
            }
          }}
          placeholder="輸入標題"
          className="mt-2"
        />
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!title.trim()}>
            確認推進
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
