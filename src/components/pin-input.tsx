import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface PinInputProps {
  onSubmit: (pin: string) => void;
  error?: string | null;
  loading?: boolean;
  label?: string;
  buttonText?: string;
}

export function PinInput({
  onSubmit,
  error,
  loading,
  label = "PIN",
  buttonText = "解鎖",
}: PinInputProps) {
  const [pin, setPin] = useState("");

  const isValid = pin.length >= 6 && pin.length <= 12;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isValid || loading) return;
    onSubmit(pin);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-xs">
      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        <Input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={12}
          minLength={6}
          value={pin}
          onChange={(e) => {
            // Only allow digits
            const val = e.target.value.replace(/\D/g, "");
            setPin(val);
          }}
          onKeyDown={handleKeyDown}
          placeholder="6-12 位數字"
          className="text-center text-lg tracking-widest h-12"
          autoComplete="off"
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <Button type="submit" className="w-full h-10" disabled={!isValid || loading}>
        {loading ? "處理中..." : buttonText}
      </Button>
    </form>
  );
}
