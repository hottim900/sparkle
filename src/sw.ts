/// <reference lib="webworker" />

import { precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

// Precache Vite build assets
precacheAndRoute(self.__WB_MANIFEST);

const DB_NAME = "offline-queue";
const STORE_NAME = "requests";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, {
        keyPath: "id",
        autoIncrement: true,
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueue(body: unknown) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).add({
    body,
    timestamp: Date.now(),
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

async function dequeueAll(): Promise<{ id: number; body: unknown }[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearQueue() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

// Intercept POST /api/items when offline
self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Only intercept POST /api/items for offline queue
  if (
    event.request.method === "POST" &&
    url.pathname === "/api/items"
  ) {
    event.respondWith(
      fetch(event.request.clone()).catch(async () => {
        // Network failed — queue the request
        const body = await event.request.json();
        await enqueue(body);

        // Return a synthetic 202 response
        return new Response(
          JSON.stringify({
            queued: true,
            message: "已加入離線佇列，連線後將自動同步",
          }),
          {
            status: 202,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );
    return;
  }
});

// Replay queued requests when online
async function replayQueue() {
  const items = await dequeueAll();
  if (items.length === 0) return;

  let synced = 0;
  for (const item of items) {
    try {
      // We need the auth token — get it from clients
      const clients = await self.clients.matchAll({ type: "window" });
      let token = "";

      for (const client of clients) {
        // Post message to client to get token
        const channel = new MessageChannel();
        client.postMessage({ type: "GET_AUTH_TOKEN" }, [channel.port2]);
        token = await new Promise<string>((resolve) => {
          channel.port1.onmessage = (e) => resolve(e.data.token || "");
          setTimeout(() => resolve(""), 1000);
        });
        if (token) break;
      }

      await fetch("/api/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(item.body),
      });
      synced++;
    } catch {
      // If any request fails, stop and try again later
      break;
    }
  }

  if (synced > 0) {
    await clearQueue();
    // Notify clients about synced items
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.postMessage({ type: "OFFLINE_SYNC", count: synced });
    }
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "REPLAY_QUEUE") {
    replayQueue();
  }
});

// Listen for connectivity restoration
self.addEventListener("sync", () => {
  replayQueue();
});
