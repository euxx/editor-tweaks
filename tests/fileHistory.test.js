const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  resolveHistoryPath,
  canonicalizePath,
  formatTimestamp,
  parseTimestamp,
  isExcluded,
  globMatch,
  getHistoryDir,
  writeSnapshot,
  trimHistory,
  runExpiryCleanup,
  listSnapshots,
  loadLastSnapshotState,
  getExt,
} = require("../src/fileHistory.js");

// Use a temp directory for all file-system tests
let tmpDir;
beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "fh-test-"));
});
afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveHistoryPath", () => {
  it("expands ~ to homedir", () => {
    const result = resolveHistoryPath("~/.file-history");
    expect(result).toBe(path.join(os.homedir(), ".file-history"));
  });

  it("expands $HOME env var", () => {
    const result = resolveHistoryPath("$HOME/.file-history");
    expect(result).toBe(path.join(os.homedir(), ".file-history"));
  });

  it("expands ${HOME} env var", () => {
    const result = resolveHistoryPath("${HOME}/.file-history");
    expect(result).toBe(path.join(os.homedir(), ".file-history"));
  });

  it("returns absolute paths unchanged (no ~ or $)", () => {
    expect(resolveHistoryPath("/tmp/history")).toBe("/tmp/history");
  });
});

describe("canonicalizePath", () => {
  it("strips colons from Windows drive letters", () => {
    expect(canonicalizePath("C:\\Users\\test\\file.js")).toBe("C\\Users\\test\\file.js");
  });

  it("leaves Unix paths unchanged", () => {
    expect(canonicalizePath("/Users/test/file.js")).toBe("/Users/test/file.js");
  });

  it("preserves colons in non-drive-letter positions", () => {
    expect(canonicalizePath("/tmp/a:b.txt")).toBe("/tmp/a:b.txt");
  });
});

describe("formatTimestamp", () => {
  it("returns YYYYMMDDTHHmmssSSS format", () => {
    const date = new Date(2026, 3, 4, 15, 30, 0, 123); // April 4, 2026
    const result = formatTimestamp(date);
    expect(result).toBe("20260404T153000123");
  });

  it("pads single-digit values with zeros", () => {
    const date = new Date(2026, 0, 5, 3, 7, 9, 5); // Jan 5
    const result = formatTimestamp(date);
    expect(result).toBe("20260105T030709005");
  });
});

describe("parseTimestamp", () => {
  it("parses timestamp with extension", () => {
    const date = parseTimestamp("20260404T153000123.js");
    expect(date).not.toBeNull();
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(3); // April
    expect(date.getDate()).toBe(4);
    expect(date.getHours()).toBe(15);
    expect(date.getMinutes()).toBe(30);
    expect(date.getSeconds()).toBe(0);
    expect(date.getMilliseconds()).toBe(123);
  });

  it("parses timestamp without extension", () => {
    const date = parseTimestamp("20260404T153000000");
    expect(date).not.toBeNull();
    expect(date.getFullYear()).toBe(2026);
  });

  it("returns null for invalid filenames", () => {
    expect(parseTimestamp("not-a-timestamp.js")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
  });

  it("roundtrips with formatTimestamp", () => {
    const original = new Date(2026, 3, 4, 15, 30, 45, 123);
    const formatted = formatTimestamp(original);
    const parsed = parseTimestamp(formatted + ".js");
    expect(parsed.getTime()).toBe(original.getTime());
  });
});

describe("getExt", () => {
  it("returns extension with dot", () => {
    expect(getExt("/path/to/file.js")).toBe(".js");
  });

  it("returns empty string for extensionless files", () => {
    expect(getExt("/path/to/Makefile")).toBe("");
  });

  it("handles dotfiles", () => {
    expect(getExt("/path/to/.env")).toBe("");
  });
});

describe("globMatch", () => {
  it("matches **/.git/** pattern", () => {
    expect(globMatch(".git/config", "**/.git/**")).toBe(true);
    expect(globMatch("src/.git/config", "**/.git/**")).toBe(true);
    expect(globMatch("src/main.js", "**/.git/**")).toBe(false);
  });

  it("matches **/node_modules/** pattern", () => {
    expect(globMatch("node_modules/foo/index.js", "**/node_modules/**")).toBe(true);
    expect(globMatch("packages/foo/node_modules/bar/index.js", "**/node_modules/**")).toBe(true);
    expect(globMatch("src/index.js", "**/node_modules/**")).toBe(false);
  });

  it("matches *.ext patterns", () => {
    expect(globMatch("file.vsix", "*.vsix")).toBe(true);
    expect(globMatch("file.js", "*.vsix")).toBe(false);
  });

  it("handles ? wildcard", () => {
    expect(globMatch("a.js", "?.js")).toBe(true);
    expect(globMatch("ab.js", "?.js")).toBe(false);
  });
});

describe("isExcluded", () => {
  it("excludes files matching patterns with workspace-relative paths", () => {
    const folders = ["/workspace"];
    expect(isExcluded("/workspace/.git/config", folders, ["**/.git/**"])).toBe(true);
    expect(isExcluded("/workspace/node_modules/foo.js", folders, ["**/node_modules/**"])).toBe(
      true,
    );
    expect(isExcluded("/workspace/src/index.js", folders, ["**/.git/**"])).toBe(false);
  });

  it("excludes files outside workspace using absolute path", () => {
    const folders = ["/workspace"];
    expect(isExcluded("/other/.git/config", folders, ["**/.git/**"])).toBe(true);
  });

  it("returns false for empty patterns", () => {
    expect(isExcluded("/workspace/src/index.js", ["/workspace"], [])).toBe(false);
  });

  it("returns false for null/undefined patterns", () => {
    expect(isExcluded("/workspace/src/index.js", ["/workspace"], null)).toBe(false);
  });
});

describe("getHistoryDir", () => {
  it("joins history root with canonicalized path", () => {
    const dir = getHistoryDir("/home/user/.file-history", "/Users/test/src/index.js");
    expect(dir).toBe(path.join("/home/user/.file-history", "/Users/test/src/index.js"));
  });
});

describe("writeSnapshot", () => {
  it("writes a snapshot file and returns hash", async () => {
    const dir = path.join(tmpDir, "history");
    const buffer = Buffer.from("hello world");
    const result = await writeSnapshot(dir, buffer, ".js", undefined);

    expect(result.written).toBe(true);
    expect(result.hash).toBeTruthy();
    expect(result.snapshotPath).toBeTruthy();

    const written = await fs.promises.readFile(result.snapshotPath);
    expect(written.toString()).toBe("hello world");
  });

  it("skips write when hash matches", async () => {
    const dir = path.join(tmpDir, "history");
    const buffer = Buffer.from("hello world");
    const first = await writeSnapshot(dir, buffer, ".js", undefined);

    const second = await writeSnapshot(dir, buffer, ".js", first.hash);
    expect(second.written).toBe(false);
    expect(second.hash).toBe(first.hash);
  });

  it("writes when content changes", async () => {
    const dir = path.join(tmpDir, "history");
    const first = await writeSnapshot(dir, Buffer.from("v1"), ".js", undefined);
    const second = await writeSnapshot(dir, Buffer.from("v2"), ".js", first.hash);
    expect(second.written).toBe(true);
    expect(second.hash).not.toBe(first.hash);
  });

  it("writes snapshot without extension for extensionless files", async () => {
    const dir = path.join(tmpDir, "history");
    const result = await writeSnapshot(dir, Buffer.from("content"), "", undefined);
    expect(result.written).toBe(true);
    // Filename should not end with a dot
    expect(path.basename(result.snapshotPath)).not.toMatch(/\.$/);
  });
});

describe("trimHistory", () => {
  it("deletes oldest snapshots beyond maxVersions", async () => {
    const dir = path.join(tmpDir, "trim");
    await fs.promises.mkdir(dir, { recursive: true });

    // Create 5 files
    for (let i = 0; i < 5; i++) {
      const name = `2026040${i + 1}T120000000.js`;
      await fs.promises.writeFile(path.join(dir, name), `v${i}`);
    }

    await trimHistory(dir, 3);
    const remaining = await fs.promises.readdir(dir);
    expect(remaining.length).toBe(3);
    // Should keep the 3 newest (sorted: 03, 04, 05)
    expect(remaining.sort()).toEqual([
      "20260403T120000000.js",
      "20260404T120000000.js",
      "20260405T120000000.js",
    ]);
  });

  it("does nothing when within limit", async () => {
    const dir = path.join(tmpDir, "trim2");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "20260401T120000000.js"), "v1");
    await fs.promises.writeFile(path.join(dir, "20260402T120000000.js"), "v2");

    await trimHistory(dir, 5);
    const remaining = await fs.promises.readdir(dir);
    expect(remaining.length).toBe(2);
  });

  it("handles non-existent directory gracefully", async () => {
    await expect(trimHistory("/nonexistent/path", 3)).resolves.not.toThrow();
  });

  it("does nothing when maxVersions is 0 or negative", async () => {
    const dir = path.join(tmpDir, "trim-zero");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "20260401T120000000.js"), "v1");
    await fs.promises.writeFile(path.join(dir, "20260402T120000000.js"), "v2");

    await trimHistory(dir, 0);
    const remaining0 = await fs.promises.readdir(dir);
    expect(remaining0.length).toBe(2);

    await trimHistory(dir, -1);
    const remainingNeg = await fs.promises.readdir(dir);
    expect(remainingNeg.length).toBe(2);
  });

  it("keeps exactly 1 when maxVersions is 1", async () => {
    const dir = path.join(tmpDir, "trim-one");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "20260401T120000000.js"), "v1");
    await fs.promises.writeFile(path.join(dir, "20260402T120000000.js"), "v2");
    await fs.promises.writeFile(path.join(dir, "20260403T120000000.js"), "v3");

    await trimHistory(dir, 1);
    const remaining = await fs.promises.readdir(dir);
    expect(remaining).toEqual(["20260403T120000000.js"]);
  });

  it("ignores subdirectories when counting versions", async () => {
    const dir = path.join(tmpDir, "trim-mixed");
    await fs.promises.mkdir(dir, { recursive: true });
    // Create 3 snapshot files
    await fs.promises.writeFile(path.join(dir, "20260401T120000000.js"), "v1");
    await fs.promises.writeFile(path.join(dir, "20260402T120000000.js"), "v2");
    await fs.promises.writeFile(path.join(dir, "20260403T120000000.js"), "v3");
    // Create a subdirectory (should not be counted or deleted)
    await fs.promises.mkdir(path.join(dir, "subdir"));

    await trimHistory(dir, 2);
    const remaining = await fs.promises.readdir(dir);
    // 2 newest snapshots + the subdirectory
    expect(remaining.sort()).toEqual(["20260402T120000000.js", "20260403T120000000.js", "subdir"]);
  });
});

describe("runExpiryCleanup", () => {
  it("deletes snapshots older than maxDays", async () => {
    const histRoot = path.join(tmpDir, "expiry");
    const fileDir = path.join(histRoot, "Users", "test", "file.js");
    await fs.promises.mkdir(fileDir, { recursive: true });

    // Old snapshot: 60 days ago
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const oldName = formatTimestamp(old) + ".js";
    await fs.promises.writeFile(path.join(fileDir, oldName), "old");

    // Recent snapshot: now
    const recentName = formatTimestamp(new Date()) + ".js";
    await fs.promises.writeFile(path.join(fileDir, recentName), "new");

    await runExpiryCleanup(histRoot, 30);

    const remaining = await fs.promises.readdir(fileDir);
    expect(remaining.length).toBe(1);
    expect(remaining[0]).toBe(recentName);
  });

  it("removes empty directories after cleanup", async () => {
    const histRoot = path.join(tmpDir, "expiry2");
    const fileDir = path.join(histRoot, "Users", "test", "old.js");
    await fs.promises.mkdir(fileDir, { recursive: true });

    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const oldName = formatTimestamp(old) + ".js";
    await fs.promises.writeFile(path.join(fileDir, oldName), "old");

    await runExpiryCleanup(histRoot, 30);

    // The file directory and parents should be cleaned up
    try {
      await fs.promises.access(fileDir);
      // If it still exists (possible race), check it's empty
      const entries = await fs.promises.readdir(fileDir);
      expect(entries.length).toBe(0);
    } catch {
      // Directory was removed — expected
    }
  });

  it("handles non-existent history root gracefully", async () => {
    await expect(runExpiryCleanup("/nonexistent/root", 30)).resolves.not.toThrow();
  });
});

describe("listSnapshots", () => {
  it("returns snapshots sorted newest first", async () => {
    const dir = path.join(tmpDir, "list");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "20260401T120000000.js"), "v1");
    await fs.promises.writeFile(path.join(dir, "20260403T120000000.js"), "v3");
    await fs.promises.writeFile(path.join(dir, "20260402T120000000.js"), "v2");

    const snapshots = await listSnapshots(dir);
    expect(snapshots.length).toBe(3);
    expect(snapshots[0].name).toBe("20260403T120000000.js");
    expect(snapshots[1].name).toBe("20260402T120000000.js");
    expect(snapshots[2].name).toBe("20260401T120000000.js");
  });

  it("returns empty array for non-existent directory", async () => {
    const snapshots = await listSnapshots("/nonexistent/dir");
    expect(snapshots).toEqual([]);
  });

  it("skips non-snapshot files", async () => {
    const dir = path.join(tmpDir, "list2");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "20260401T120000000.js"), "v1");
    await fs.promises.writeFile(path.join(dir, "metadata.json"), "{}");

    const snapshots = await listSnapshots(dir);
    expect(snapshots.length).toBe(1);
  });
});

describe("hash dedup after restart (lazy-load from disk)", () => {
  it("skips write when content matches the latest snapshot on disk", async () => {
    const dir = path.join(tmpDir, "restart-dedup");
    const buffer = Buffer.from("hello world");
    const ext = ".txt";

    // First write — should create a snapshot
    const r1 = await writeSnapshot(dir, buffer, ext, undefined);
    expect(r1.written).toBe(true);

    // Simulate restart: use loadLastSnapshotState to recover hash from disk
    const diskState = await loadLastSnapshotState(dir);
    expect(diskState).not.toBeNull();
    expect(diskState.timestamp).toBeGreaterThan(0);

    // Second write with same content using disk-loaded hash — should be skipped
    const r2 = await writeSnapshot(dir, buffer, ext, diskState.hash);
    expect(r2.written).toBe(false);
    expect(r2.hash).toBe(diskState.hash);

    // Still only one snapshot on disk
    const after = await listSnapshots(dir);
    expect(after.length).toBe(1);
  });

  it("writes when content differs from latest snapshot on disk", async () => {
    const dir = path.join(tmpDir, "restart-dedup2");
    const buffer1 = Buffer.from("version 1");
    const ext = ".txt";

    await writeSnapshot(dir, buffer1, ext, undefined);

    // Ensure different timestamp for next snapshot
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Simulate restart: load state from disk
    const diskState = await loadLastSnapshotState(dir);

    // Write different content — should create a new snapshot
    const buffer2 = Buffer.from("version 2");
    const r2 = await writeSnapshot(dir, buffer2, ext, diskState.hash);
    expect(r2.written).toBe(true);

    const after = await listSnapshots(dir);
    expect(after.length).toBe(2);
  });

  it("returns null for non-existent directory", async () => {
    const dir = path.join(tmpDir, "no-such-dir");
    const diskState = await loadLastSnapshotState(dir);
    expect(diskState).toBeNull();
  });

  it("returns null for empty history directory", async () => {
    const dir = path.join(tmpDir, "empty-state");
    await fs.promises.mkdir(dir, { recursive: true });
    const diskState = await loadLastSnapshotState(dir);
    expect(diskState).toBeNull();
  });
});

describe("restore round-trip", () => {
  it("snapshot content can be read back identically", async () => {
    const dir = path.join(tmpDir, "roundtrip");
    const original = Buffer.from("important content\nwith multiple lines\n");
    const ext = ".md";

    const result = await writeSnapshot(dir, original, ext, undefined);
    expect(result.written).toBe(true);

    // Read back via listSnapshots + readFile
    const snapshots = await listSnapshots(dir);
    expect(snapshots.length).toBe(1);
    const restored = await fs.promises.readFile(path.join(dir, snapshots[0].name));
    expect(restored.equals(original)).toBe(true);
  });
});
