import { request } from "./api";
import type { Item } from "./types";

function privateHeaders(token: string) {
  return { "X-Private-Token": token };
}

export async function getPrivateStatus(): Promise<{ configured: boolean }> {
  return request("/private/status");
}

export async function setupPin(pin: string): Promise<void> {
  return request("/private/setup", {
    method: "POST",
    body: JSON.stringify({ pin }),
    headers: { "Content-Type": "application/json" },
  });
}

export async function unlockPrivate(pin: string): Promise<{ token: string }> {
  return request("/private/unlock", {
    method: "POST",
    body: JSON.stringify({ pin }),
    headers: { "Content-Type": "application/json" },
  });
}

export async function lockPrivate(token: string): Promise<void> {
  return request("/private/lock", {
    method: "POST",
    headers: privateHeaders(token),
  });
}

export async function listPrivateItems(
  token: string,
  params?: Record<string, string>,
): Promise<{ items: Item[]; total: number }> {
  const query = params ? "?" + new URLSearchParams(params).toString() : "";
  return request(`/private/items${query}`, { headers: privateHeaders(token) });
}

export async function getPrivateItem(token: string, id: string): Promise<Item> {
  return request(`/private/items/${id}`, { headers: privateHeaders(token) });
}

export async function createPrivateItem(
  token: string,
  body: Record<string, unknown>,
): Promise<Item> {
  return request("/private/items", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { ...privateHeaders(token), "Content-Type": "application/json" },
  });
}

export async function updatePrivateItem(
  token: string,
  id: string,
  body: Record<string, unknown>,
): Promise<Item> {
  return request(`/private/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { ...privateHeaders(token), "Content-Type": "application/json" },
  });
}

export async function deletePrivateItem(token: string, id: string): Promise<void> {
  return request(`/private/items/${id}`, {
    method: "DELETE",
    headers: privateHeaders(token),
  });
}

export async function searchPrivateItems(
  token: string,
  query: string,
  limit = 20,
): Promise<Item[]> {
  return request(`/private/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
    headers: privateHeaders(token),
  });
}

export async function getPrivateTags(token: string): Promise<string[]> {
  return request("/private/tags", { headers: privateHeaders(token) });
}

export async function changePin(token: string, oldPin: string, newPin: string): Promise<void> {
  return request("/private/pin", {
    method: "PATCH",
    body: JSON.stringify({ old_pin: oldPin, new_pin: newPin }),
    headers: { ...privateHeaders(token), "Content-Type": "application/json" },
  });
}
