import { useState, type ReactNode } from "react";
import { hasToken, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuthGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(hasToken());
  const [token, setTokenInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (authenticated) {
    return <>{children}</>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError("請輸入存取權杖");
      return;
    }

    setLoading(true);
    setError("");

    // Test the token by making a request
    try {
      const res = await fetch("/api/items?limit=1", {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });

      if (res.ok) {
        setToken(token.trim());
        setAuthenticated(true);
      } else {
        setError("權杖無效");
      }
    } catch {
      setError("無法連線到伺服器");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Capture Hub</h1>
          <p className="text-muted-foreground text-sm">請輸入存取權杖以登入</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="存取權杖"
            value={token}
            onChange={(e) => setTokenInput(e.target.value)}
            autoFocus
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "驗證中..." : "登入"}
          </Button>
        </form>
      </div>
    </div>
  );
}
