// vitest globals (describe, it, expect) are injected via globals:true in vitest.config.mjs
const { computeRemovals, workspacePath, filePath } = require("../src/pruneRecentlyOpened.js");

// Helper: build a fake vscode.Uri with the given scheme and fsPath
function makeUri(scheme, fspath) {
  return { scheme, fsPath: fspath };
}

// Helper: build a recently-opened workspace entry (folder)
function folder(fspath, scheme = "file") {
  return { folderUri: makeUri(scheme, fspath) };
}

// Helper: build a recently-opened workspace entry (.code-workspace file)
function workspace(fspath, scheme = "file") {
  return { workspace: { configPath: makeUri(scheme, fspath) } };
}

// Helper: build a recently-opened file entry
function file(fspath, scheme = "file") {
  return { fileUri: makeUri(scheme, fspath) };
}

// existsFn that treats specific paths as missing
function existsFn(missing) {
  return (p) => !missing.includes(p);
}

// existsFn that says everything exists
const allExist = () => true;
// existsFn that says nothing exists
const noneExist = () => false;

describe("workspacePath", () => {
  it("returns fsPath for a file:// folder entry", () => {
    expect(workspacePath(folder("/home/user/project"))).toBe("/home/user/project");
  });

  it("returns fsPath for a file:// workspace (.code-workspace) entry", () => {
    expect(workspacePath(workspace("/home/user/my.code-workspace"))).toBe(
      "/home/user/my.code-workspace",
    );
  });

  it("returns null for non-file:// folder entry (e.g. SSH)", () => {
    expect(workspacePath(folder("/host/project", "vscode-remote"))).toBeNull();
  });

  it("returns null for non-file:// workspace entry", () => {
    expect(workspacePath(workspace("/host/my.code-workspace", "vscode-remote"))).toBeNull();
  });
});

describe("filePath", () => {
  it("returns fsPath for a file:// file entry", () => {
    expect(filePath(file("/home/user/notes.md"))).toBe("/home/user/notes.md");
  });

  it("returns null for non-file:// file entry", () => {
    expect(filePath(file("/host/notes.md", "vscode-remote"))).toBeNull();
  });
});

describe("computeRemovals — stale entry removal", () => {
  it("removes workspace entries whose paths no longer exist", () => {
    const workspaces = [folder("/exists"), folder("/missing")];
    const result = computeRemovals(workspaces, [], -1, existsFn(["/missing"]));
    expect(result).toEqual(["/missing"]);
  });

  it("removes file entries whose paths no longer exist", () => {
    const files = [file("/exists.txt"), file("/gone.txt")];
    const result = computeRemovals([], files, -1, existsFn(["/gone.txt"]));
    expect(result).toEqual(["/gone.txt"]);
  });

  it("keeps entries that exist on disk", () => {
    const workspaces = [folder("/a"), folder("/b")];
    const files = [file("/c.txt")];
    expect(computeRemovals(workspaces, files, -1, allExist)).toEqual([]);
  });

  it("removes all entries when nothing exists", () => {
    const workspaces = [folder("/a"), folder("/b")];
    const files = [file("/c.txt")];
    const result = computeRemovals(workspaces, files, -1, noneExist);
    expect(result).toEqual(["/a", "/b", "/c.txt"]);
  });
});

describe("computeRemovals — non-file:// entries are always kept", () => {
  it("does not remove SSH/remote workspace entries", () => {
    const workspaces = [folder("/remote/project", "vscode-remote")];
    expect(computeRemovals(workspaces, [], -1, noneExist)).toEqual([]);
  });

  it("does not remove SSH/remote file entries", () => {
    const files = [file("/remote/file.txt", "vscode-remote")];
    expect(computeRemovals([], files, -1, noneExist)).toEqual([]);
  });

  it("does not count non-file:// entries toward the maxItems limit", () => {
    // maxItems = 1, two local folders, plus one remote folder
    // The remote one should not count; only the older local one should be removed
    const workspaces = [folder("/a"), folder("/b"), folder("/remote", "vscode-remote")];
    const result = computeRemovals(workspaces, [], 1, allExist);
    expect(result).toEqual(["/b"]); // /a is kept (first = most recent), /b exceeds limit
  });
});

describe("computeRemovals — maxItems limit", () => {
  it("removes oldest entries beyond the per-category limit", () => {
    // maxItems = 2, entries are most-recent-first
    const workspaces = [folder("/a"), folder("/b"), folder("/c")];
    const result = computeRemovals(workspaces, [], 2, allExist);
    expect(result).toEqual(["/c"]); // /a and /b are kept, /c is the 3rd
  });

  it("applies the limit independently to workspaces and files", () => {
    const workspaces = [folder("/w1"), folder("/w2"), folder("/w3")];
    const files = [file("/f1.txt"), file("/f2.txt"), file("/f3.txt")];
    const result = computeRemovals(workspaces, files, 2, allExist);
    expect(result).toEqual(["/w3", "/f3.txt"]);
  });

  it("removes stale entries before counting toward limit", () => {
    // /b is stale, so with maxItems=2 and valid entries /a, /c, /d — /d should be removed
    const workspaces = [folder("/a"), folder("/b"), folder("/c"), folder("/d")];
    const result = computeRemovals(workspaces, [], 2, existsFn(["/b"]));
    // /b is stale (removed), then /a and /c are kept (limit = 2), /d is removed
    expect(result).toEqual(["/b", "/d"]);
  });

  it("does not remove anything when maxItems is -1 (unlimited)", () => {
    const workspaces = [folder("/x"), folder("/y"), folder("/z")];
    expect(computeRemovals(workspaces, [], -1, allExist)).toEqual([]);
  });

  it("does not remove anything when maxItems equals the entry count", () => {
    const workspaces = [folder("/a"), folder("/b")];
    expect(computeRemovals(workspaces, [], 2, allExist)).toEqual([]);
  });
});

describe("computeRemovals — empty inputs", () => {
  it("handles empty workspaces and files arrays", () => {
    expect(computeRemovals([], [], -1, allExist)).toEqual([]);
  });

  it("handles maxItems = 0 (keep nothing)", () => {
    const workspaces = [folder("/a"), folder("/b")];
    const result = computeRemovals(workspaces, [], 0, allExist);
    expect(result).toEqual(["/a", "/b"]);
  });
});
