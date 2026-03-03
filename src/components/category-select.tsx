import { useState, useEffect, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { listCategories, createCategory } from "@/lib/api";
import type { Category } from "@/lib/types";

const NONE_VALUE = "__none__";
const CREATE_VALUE = "__create__";

interface CategorySelectProps {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  disabled?: boolean;
}

export function CategorySelect({ value, onChange, disabled }: CategorySelectProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [createInputValue, setCreateInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldFocusCreateInput = useRef(false);

  useEffect(() => {
    listCategories().then((res) => {
      setCategories(res.categories.sort((a, b) => a.sort_order - b.sort_order));
    });
  }, []);

  const handleValueChange = (v: string) => {
    if (v === CREATE_VALUE) {
      setShowCreateInput(true);
      setCreateInputValue("");
      shouldFocusCreateInput.current = true;
      return;
    }
    onChange(v === NONE_VALUE ? null : v);
  };

  const handleCreateSubmit = async () => {
    const name = createInputValue.trim();
    if (!name) return;

    const newCat = await createCategory({ name });
    setCategories((prev) => [...prev, newCat]);
    setShowCreateInput(false);
    setCreateInputValue("");
    onChange(newCat.id);
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateSubmit();
    } else if (e.key === "Escape") {
      setShowCreateInput(false);
      setCreateInputValue("");
    }
  };

  useEffect(() => {
    if (showCreateInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCreateInput]);

  const selectedCategory = categories.find((c) => c.id === value);
  const displayValue = value && selectedCategory ? value : NONE_VALUE;

  return (
    <div>
      <Select value={displayValue} onValueChange={handleValueChange} disabled={disabled}>
        <SelectTrigger className="w-32">
          <SelectValue>
            {selectedCategory ? (
              <span className="flex items-center gap-1.5">
                {selectedCategory.color && (
                  <span
                    className="inline-block size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: selectedCategory.color }}
                  />
                )}
                {selectedCategory.name}
              </span>
            ) : (
              "未分類"
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          onCloseAutoFocus={(e) => {
            if (shouldFocusCreateInput.current) {
              e.preventDefault();
              shouldFocusCreateInput.current = false;
            }
          }}
        >
          <SelectItem value={NONE_VALUE}>未分類</SelectItem>
          {categories.map((cat) => (
            <SelectItem key={cat.id} value={cat.id}>
              <span className="flex items-center gap-1.5">
                {cat.color && (
                  <span
                    className="inline-block size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                )}
                {cat.name}
              </span>
            </SelectItem>
          ))}
          <SelectItem value={CREATE_VALUE}>+ 新增分類</SelectItem>
        </SelectContent>
      </Select>

      {showCreateInput && (
        <Input
          ref={inputRef}
          className="mt-2 w-32"
          placeholder="分類名稱..."
          value={createInputValue}
          onChange={(e) => setCreateInputValue(e.target.value)}
          onKeyDown={handleCreateKeyDown}
        />
      )}
    </div>
  );
}
