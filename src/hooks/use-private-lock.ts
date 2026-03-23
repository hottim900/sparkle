import { useState, useEffect, useRef, useCallback } from "react";
import { flushSync } from "react-dom";
import { getToken } from "@/lib/api";

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_BLUR_GRACE_MS = 200;
const IDLE_THROTTLE_MS = 30_000; // Only reset idle timer if 30s+ since last reset

interface UsePrivateLockOptions {
  sessionToken: string | null;
  onLock: () => void;
  idleTimeoutMs?: number;
  blurGraceMs?: number;
}

interface UsePrivateLockReturn {
  overlayVisible: boolean;
  clearOverlay: () => void;
}

export function usePrivateLock({
  sessionToken,
  onLock,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  blurGraceMs = DEFAULT_BLUR_GRACE_MS,
}: UsePrivateLockOptions): UsePrivateLockReturn {
  const [overlayVisible, setOverlayVisible] = useState(false);

  // Refs for stale-closure prevention — synced in effects for React 19 concurrent safety
  const sessionTokenRef = useRef(sessionToken);
  useEffect(() => {
    sessionTokenRef.current = sessionToken;
  });

  const onLockRef = useRef(onLock);
  useEffect(() => {
    onLockRef.current = onLock;
  });

  // Double-lock prevention: reset when a new token arrives (re-unlock)
  const lockedRef = useRef(false);
  useEffect(() => {
    if (sessionToken) lockedRef.current = false;
  }, [sessionToken]);

  // Timer refs
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const blurGraceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastActivityRef = useRef(Date.now());

  // --- fireLock: raw fetch with keepalive (not request() helper) ---
  const fireLock = useCallback(() => {
    if (lockedRef.current) return;
    const token = sessionTokenRef.current;
    if (!token) return;
    lockedRef.current = true;
    const authToken = getToken();
    fetch("/api/private/lock", {
      method: "POST",
      headers: {
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
        "X-Private-Token": token,
      },
      keepalive: true,
    });
  }, []);

  // --- Shared lock sequence: overlay → fireLock → onLock ---
  const performLock = useCallback(() => {
    if (lockedRef.current) return;
    flushSync(() => setOverlayVisible(true));
    fireLock();
    onLockRef.current();
  }, [fireLock]);

  // --- Trigger A: visibilitychange ---
  useEffect(() => {
    if (!sessionToken) return;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        performLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [sessionToken, performLock]);

  // --- Trigger B: blur/focus (overlay-only, no lock API) ---
  useEffect(() => {
    if (!sessionToken) return;

    const handleBlur = () => {
      if (lockedRef.current) return;
      if (blurGraceTimerRef.current) return; // Already pending
      blurGraceTimerRef.current = setTimeout(() => {
        blurGraceTimerRef.current = undefined;
        if (!lockedRef.current && sessionTokenRef.current) {
          flushSync(() => setOverlayVisible(true));
        }
      }, blurGraceMs);
    };

    const handleFocus = () => {
      // Cancel pending grace timer
      if (blurGraceTimerRef.current) {
        clearTimeout(blurGraceTimerRef.current);
        blurGraceTimerRef.current = undefined;
      }
      // Hide blur-only overlay (not a full lock)
      if (!lockedRef.current) {
        setOverlayVisible(false);
      }
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      if (blurGraceTimerRef.current) {
        clearTimeout(blurGraceTimerRef.current);
        blurGraceTimerRef.current = undefined;
      }
    };
  }, [sessionToken, blurGraceMs]);

  // --- Trigger C: idle timer ---
  useEffect(() => {
    if (!sessionToken) return;

    // Start idle timer
    lastActivityRef.current = Date.now();
    idleTimerRef.current = setTimeout(() => {
      if (sessionTokenRef.current) performLock();
    }, idleTimeoutMs);

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current < IDLE_THROTTLE_MS) return;
      lastActivityRef.current = now;
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (sessionTokenRef.current) performLock();
      }, idleTimeoutMs);
    };

    document.addEventListener("pointerdown", handleActivity, { passive: true });
    document.addEventListener("keydown", handleActivity, { passive: true });
    document.addEventListener("scroll", handleActivity, { passive: true });

    return () => {
      document.removeEventListener("pointerdown", handleActivity);
      document.removeEventListener("keydown", handleActivity);
      document.removeEventListener("scroll", handleActivity);
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = undefined;
    };
  }, [sessionToken, idleTimeoutMs, performLock]);

  // --- Trigger D: unmount (route navigation away) ---
  useEffect(() => {
    if (!sessionToken) return;
    return () => {
      fireLock();
    };
  }, [sessionToken, fireLock]);

  // --- clearOverlay: called on successful PIN unlock ---
  const clearOverlay = useCallback(() => {
    setOverlayVisible(false);
  }, []);

  return { overlayVisible, clearOverlay };
}
