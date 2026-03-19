import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "./fs.js";
import { resolve, join, relative, dirname } from "node:path";
import { getSettings } from "./client.js";
import type { VaultFrontmatter, VaultFile } from "./types.js";

// --- Settings cache ---

let cachedVaultPath: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getVaultPath(): Promise<string> {
  const now = Date.now();
  if (cachedVaultPath && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVaultPath;
  }
  const settings = await getSettings();
  if (settings.obsidian_enabled !== "true") {
    throw new Error(
      "Obsidian integration is not enabled. Configure it in Sparkle settings.",
    );
  }
  if (!settings.obsidian_vault_path) {
    throw new Error(
      "Obsidian vault path is not configured. Set it in Sparkle settings.",
    );
  }
  cachedVaultPath = settings.obsidian_vault_path;
  cacheTimestamp = now;
  return cachedVaultPath;
}

/** Reset the settings cache (for testing) */
export function _resetCache(): void {
  cachedVaultPath = null;
  cacheTimestamp = 0;
}

// --- Path security ---

export function resolveVaultPath(vaultRoot: string, relativePath: string): string {
  const resolvedRoot = resolve(vaultRoot);
  const resolved = resolve(vaultRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + "/")) {
    throw new Error(`Path "${relativePath}" resolves outside the vault. Access denied.`);
  }
  return resolved;
}

// --- Frontmatter parsing (internal — for sparkle_id lookup and list summaries) ---
// Handles the YAML subset produced by Sparkle's generateFrontmatter():
// scalar values (quoted/unquoted), YAML arrays (  - item).

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

export function parseFrontmatter(content: string): VaultFrontmatter {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return {};

  const fm: VaultFrontmatter = {};
  const lines = match[1].split("\n");
  let pendingList: { key: string; items: string[] } | null = null;

  for (const line of lines) {
    // Array item: "  - value" or '  - "value"'
    const arrayItemMatch = line.match(/^\s+-\s+(.+)/);
    if (arrayItemMatch && pendingList) {
      const val = arrayItemMatch[1].replace(/^["']|["']$/g, "");
      pendingList.items.push(val);
      continue;
    }

    // Flush previous array
    if (pendingList) {
      fm[pendingList.key] = pendingList.items;
      pendingList = null;
    }

    // Key-value pair: "key: value" or "key:"
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawVal = kvMatch[2].trim();
      if (rawVal === "" || rawVal === "|") {
        // Empty value — start of array or multiline
        pendingList = { key, items: [] };
      } else {
        // Strip surrounding quotes
        fm[key] = rawVal.replace(/^["']|["']$/g, "");
      }
    }
  }

  // Flush last array
  if (pendingList) {
    fm[pendingList.key] = pendingList.items;
  }

  return fm;
}

export function extractBody(content: string): string {
  return content.replace(FRONTMATTER_REGEX, "").trim();
}

// --- sparkle_id index ---

const sparkleIdIndex = new Map<string, string>(); // sparkle_id -> absolute path
let indexBuilt = false;

function walkSync(dir: string, callback: (filePath: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSync(fullPath, callback);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      callback(fullPath);
    }
  }
}

function buildIndex(vaultRoot: string): void {
  sparkleIdIndex.clear();
  walkSync(vaultRoot, (filePath) => {
    try {
      const content = readFileSync(filePath, "utf-8");
      const fm = parseFrontmatter(content);
      if (fm.sparkle_id && typeof fm.sparkle_id === "string") {
        sparkleIdIndex.set(fm.sparkle_id, filePath);
      }
    } catch {
      /* skip unreadable files */
    }
  });
  indexBuilt = true;
}

/** Find a vault file by sparkle_id. Returns path and cached content if available. */
export async function findBySparkleId(
  sparkleId: string,
): Promise<{ path: string; content: string } | null> {
  const vaultRoot = await getVaultPath();

  // Check cache first
  if (indexBuilt) {
    const cached = sparkleIdIndex.get(sparkleId);
    if (cached && existsSync(cached)) {
      // Verify the file still has this sparkle_id
      const content = readFileSync(cached, "utf-8");
      const fm = parseFrontmatter(content);
      if (fm.sparkle_id === sparkleId) return { path: cached, content };
    }
  }

  // Cache miss or stale: rebuild
  buildIndex(vaultRoot);
  const found = sparkleIdIndex.get(sparkleId);
  if (!found) return null;
  const content = readFileSync(found, "utf-8");
  return { path: found, content };
}

/** Reset the sparkle_id index (for testing) */
export function _resetIndex(): void {
  sparkleIdIndex.clear();
  indexBuilt = false;
}

// --- Read/write operations ---

export async function readVaultFileBySparkleId(sparkleId: string): Promise<VaultFile> {
  const result = await findBySparkleId(sparkleId);
  if (!result) {
    throw new Error(`No vault file found with sparkle_id: ${sparkleId}`);
  }
  const vaultRoot = await getVaultPath();
  return {
    path: relative(vaultRoot, result.path),
    content: result.content,
    frontmatter: parseFrontmatter(result.content),
    body: extractBody(result.content),
  };
}

export async function readVaultFileByPath(relativePath: string): Promise<VaultFile> {
  const vaultRoot = await getVaultPath();
  const absPath = resolveVaultPath(vaultRoot, relativePath);
  try {
    const content = readFileSync(absPath, "utf-8");
    return {
      path: relativePath,
      content,
      frontmatter: parseFrontmatter(content),
      body: extractBody(content),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`File not found: ${relativePath}`);
    }
    throw error;
  }
}

export async function writeVaultFileBySparkleId(
  sparkleId: string,
  content: string,
): Promise<string> {
  const result = await findBySparkleId(sparkleId);
  if (!result) {
    throw new Error(`No vault file found with sparkle_id: ${sparkleId}`);
  }
  writeFileSync(result.path, content, "utf-8");
  // Update index if sparkle_id changed
  const fm = parseFrontmatter(content);
  if (fm.sparkle_id && fm.sparkle_id !== sparkleId) {
    sparkleIdIndex.delete(sparkleId);
    sparkleIdIndex.set(fm.sparkle_id, result.path);
  }
  const vaultRoot = await getVaultPath();
  return relative(vaultRoot, result.path);
}

export async function writeVaultFileByPath(
  relativePath: string,
  content: string,
): Promise<string> {
  const vaultRoot = await getVaultPath();
  const absPath = resolveVaultPath(vaultRoot, relativePath);
  // Create parent directories if needed
  const dir = dirname(absPath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(absPath, content, "utf-8");
  // Update sparkle_id index
  const fm = parseFrontmatter(content);
  if (fm.sparkle_id && typeof fm.sparkle_id === "string") {
    sparkleIdIndex.set(fm.sparkle_id, absPath);
  }
  return relativePath;
}
