import * as React from "react";

interface AnnouncementContextType {
  announce: (message: string) => void;
}

const AnnouncementContext = React.createContext<AnnouncementContextType | null>(null);

/**
 * Single sr-only aria-live region mounted near the app root. Consumers call
 * `useAnnouncement()` to push status messages (e.g. "vault 路徑已更新" after
 * an async reverse-lookup resolves to a new path post-rename).
 *
 * The `setMessage("")` + `requestAnimationFrame` toggle ensures repeating the
 * same string still re-fires the screen-reader announcement; without it,
 * setting state to an identical value is a React no-op.
 */
export function AnnouncementProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState("");

  const announce = React.useCallback((m: string) => {
    setMessage("");
    requestAnimationFrame(() => setMessage(m));
  }, []);

  const value = React.useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncementContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
    </AnnouncementContext.Provider>
  );
}

const noopAnnounce: (message: string) => void = () => {};

/**
 * Returns a callable announcer. Outside an `<AnnouncementProvider>` (e.g.
 * isolated component tests that don't mount the app shell), this falls back
 * to a no-op so consumers don't have to mock the provider just to render.
 */
export function useAnnouncement(): (message: string) => void {
  const ctx = React.useContext(AnnouncementContext);
  return ctx?.announce ?? noopAnnounce;
}
