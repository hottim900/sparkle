import Database from "better-sqlite3";

// npm audit does not check the SQLite amalgamation inside the native addon.
// 3.53.2 includes the WAL-reset fix and CVE-2026-11822 / CVE-2026-11824 fixes.
const minimum = [3, 53, 2];
const database = new Database(":memory:");
try {
  const { version } = database.prepare("SELECT sqlite_version() AS version").get();
  const actual = version.split(".").map(Number);
  const firstDifference = minimum.findIndex((value, index) => actual[index] !== value);
  if (firstDifference !== -1 && actual[firstDifference] < minimum[firstDifference]) {
    throw new Error(`SQLite ${version} is below the patched minimum ${minimum.join(".")}`);
  }
  console.log(`Native SQLite ${version}: security minimum satisfied`);
} finally {
  database.close();
}
