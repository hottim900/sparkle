import { useState, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";

interface TagInputProps {
  tags: string[];
  allTags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder?: string;
}

export function TagInput({
  tags,
  allTags,
  onAdd,
  onRemove,
  placeholder = "新增標籤...",
}: TagInputProps) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const listboxRef = useRef<HTMLDivElement>(null);

  const suggestions = input.trim()
    ? allTags.filter((t) => t.toLowerCase().includes(input.toLowerCase()) && !tags.includes(t))
    : [];

  const visibleSuggestions = suggestions.slice(0, 5);
  const suggestionsVisible = showSuggestions && input.length > 0 && visibleSuggestions.length > 0;

  useEffect(() => {
    if (visibleSuggestions.length > 0 && showSuggestions) {
      setHighlightedIndex(0);
    } else {
      setHighlightedIndex(-1);
    }
  }, [input, visibleSuggestions.length, showSuggestions]);

  const handleAdd = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onAdd(trimmed);
    }
    setInput("");
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  };

  const activeDescendant =
    suggestionsVisible && highlightedIndex >= 0 ? `tag-suggestion-${highlightedIndex}` : undefined;

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            <button type="button" onClick={() => onRemove(tag)}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="relative">
        <div className="flex gap-1">
          <Input
            className="flex-1"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={(e) => {
              // Skip keyboard shortcuts during IME composition (e.g. Chinese input)
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown" && suggestionsVisible) {
                e.preventDefault();
                setHighlightedIndex((prev) =>
                  prev < visibleSuggestions.length - 1 ? prev + 1 : 0,
                );
              } else if (e.key === "ArrowUp" && suggestionsVisible) {
                e.preventDefault();
                setHighlightedIndex((prev) =>
                  prev > 0 ? prev - 1 : visibleSuggestions.length - 1,
                );
              } else if (e.key === "Tab" && suggestionsVisible && highlightedIndex >= 0) {
                e.preventDefault();
                handleAdd(visibleSuggestions[highlightedIndex]!);
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (suggestionsVisible && highlightedIndex >= 0) {
                  handleAdd(visibleSuggestions[highlightedIndex]!);
                } else {
                  handleAdd(input);
                }
              } else if (e.key === "Escape") {
                setShowSuggestions(false);
                setHighlightedIndex(-1);
              }
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder={placeholder}
            enterKeyHint="done"
            role="combobox"
            aria-expanded={suggestionsVisible}
            aria-activedescendant={activeDescendant}
            aria-controls={suggestionsVisible ? "tag-suggestions-listbox" : undefined}
            aria-autocomplete="list"
          />
          {input.trim() && (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="新增標籤"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAdd(input)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
        {suggestionsVisible && (
          <div
            ref={listboxRef}
            id="tag-suggestions-listbox"
            role="listbox"
            className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-32 overflow-y-auto"
          >
            {visibleSuggestions.map((tag, index) => (
              <button
                key={tag}
                id={`tag-suggestion-${index}`}
                type="button"
                role="option"
                aria-selected={index === highlightedIndex}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${
                  index === highlightedIndex ? "bg-accent" : ""
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAdd(tag)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
