import { readFile, readdir, writeFile, mkdir, access } from "./fs.js";
import { resolve, join, relative, dirname } from "node:path";
import { getSettings } from "./client.js";
import type {
  VaultFrontmatter,
  VaultFile,
  VaultSearchMatch,
  VaultSearchResult,
  VaultListEntry,
  VaultListResult,
} from "./types.js";

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
    throw new Error("Obsidian integration is not enabled. Configure it in Sparkle settings.");
  }
  if (!settings.obsidian_vault_path) {
    throw new Error("Obsidian vault path is not configured. Set it in Sparkle settings.");
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

async function walk(
  dir: string,
  callback: (filePath: string) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  if (shouldStop?.()) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (shouldStop?.()) return;
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, callback, shouldStop);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      await callback(fullPath);
    }
  }
}

async function buildIndex(vaultRoot: string): Promise<void> {
  sparkleIdIndex.clear();
  await walk(vaultRoot, async (filePath) => {
    try {
      const content = await readFile(filePath, "utf-8");
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

/** Helper: check if a file exists using fs/promises access */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Find a vault file by sparkle_id. Returns path and cached content if available. */
export async function findBySparkleId(
  sparkleId: string,
): Promise<{ path: string; content: string } | null> {
  const vaultRoot = await getVaultPath();

  // Check cache first
  if (indexBuilt) {
    const cached = sparkleIdIndex.get(sparkleId);
    if (cached && (await fileExists(cached))) {
      // Verify the file still has this sparkle_id
      const content = await readFile(cached, "utf-8");
      const fm = parseFrontmatter(content);
      if (fm.sparkle_id === sparkleId) return { path: cached, content };
    }
  }

  // Cache miss or stale: rebuild
  await buildIndex(vaultRoot);
  const found = sparkleIdIndex.get(sparkleId);
  if (!found) return null;
  const content = await readFile(found, "utf-8");
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
    const content = await readFile(absPath, "utf-8");
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
  // Validate sparkle_id preserved in frontmatter before writing
  const fm = parseFrontmatter(content);
  if (!fm.sparkle_id) {
    throw new Error(
      `Content is missing sparkle_id in frontmatter. Include "sparkle_id: ${sparkleId}" in YAML frontmatter to preserve tracking.`,
    );
  }
  await writeFile(result.path, content, "utf-8");
  // Update index if sparkle_id changed
  if (fm.sparkle_id !== sparkleId) {
    sparkleIdIndex.delete(sparkleId);
    sparkleIdIndex.set(fm.sparkle_id, result.path);
  }
  const vaultRoot = await getVaultPath();
  return relative(vaultRoot, result.path);
}

export async function writeVaultFileByPath(relativePath: string, content: string): Promise<string> {
  const vaultRoot = await getVaultPath();
  const absPath = resolveVaultPath(vaultRoot, relativePath);
  // Create parent directories if needed
  const dir = dirname(absPath);
  if (dir && !(await fileExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(absPath, content, "utf-8");
  // Update sparkle_id index
  const fm = parseFrontmatter(content);
  if (fm.sparkle_id && typeof fm.sparkle_id === "string") {
    sparkleIdIndex.set(fm.sparkle_id, absPath);
  }
  return relativePath;
}

// --- Search and list operations ---

export async function searchVault(
  query: string,
  options?: { path?: string; limit?: number },
): Promise<VaultSearchResult[]> {
  const vaultRoot = await getVaultPath();
  const searchRoot = options?.path ? resolveVaultPath(vaultRoot, options.path) : vaultRoot;
  const limit = options?.limit ?? 20;
  const queryLower = query.toLowerCase();

  const results: VaultSearchResult[] = [];

  await walk(
    searchRoot,
    async (filePath) => {
      if (results.length >= limit) return;

      try {
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const matches: VaultSearchMatch[] = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower)) {
            matches.push({
              line: i + 1,
              text: lines[i],
              context_before: lines.slice(Math.max(0, i - 2), i),
              context_after: lines.slice(i + 1, i + 3),
            });
          }
        }

        if (matches.length > 0) {
          results.push({
            path: relative(vaultRoot, filePath),
            frontmatter: parseFrontmatter(content),
            matches,
          });
        }
      } catch {
        /* skip unreadable files */
      }
    },
    () => results.length >= limit,
  );

  return results;
}

export async function listVault(options?: {
  path?: string;
  recursive?: boolean;
  limit?: number;
}): Promise<VaultListResult> {
  const vaultRoot = await getVaultPath();
  const listRoot = options?.path ? resolveVaultPath(vaultRoot, options.path) : vaultRoot;
  const recursive = options?.recursive ?? true;
  const limit = options?.limit ?? 50;

  const files: VaultListEntry[] = [];
  const directories: string[] = [];

  if (recursive) {
    await walk(
      listRoot,
      async (filePath) => {
        if (files.length >= limit) return;
        try {
          const content = await readFile(filePath, "utf-8");
          files.push({
            path: relative(vaultRoot, filePath),
            frontmatter: parseFrontmatter(content),
          });
        } catch {
          /* skip unreadable files */
        }
      },
      () => files.length >= limit,
    );
  } else {
    for (const entry of await readdir(listRoot, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(listRoot, entry.name);
      if (entry.isDirectory()) {
        directories.push(relative(vaultRoot, fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        if (files.length >= limit) continue;
        try {
          const content = await readFile(fullPath, "utf-8");
          files.push({
            path: relative(vaultRoot, fullPath),
            frontmatter: parseFrontmatter(content),
          });
        } catch {
          /* skip unreadable files */
        }
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return { files, directories: directories.sort() };
}
