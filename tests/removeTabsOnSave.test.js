// vitest globals (describe, it, expect) are injected via globals:true in vitest.config.mjs
const { convertTabs, isExcluded } = require("../src/removeTabsOnSave.js");

describe("isExcluded", () => {
  it("matches a language ID pattern", () => {
    expect(isExcluded("makefile", "/path/to/Makefile", ["makefile"])).toBe(true);
    expect(isExcluded("go", "/path/to/main.go", ["go"])).toBe(true);
  });

  it("matches an exact basename (no language ID needed)", () => {
    // "Makefile" has languageId "makefile"; exact basename match covers any capitalisation
    expect(isExcluded("makefile", "/path/to/Makefile", ["Makefile"])).toBe(true);
    expect(isExcluded("plaintext", "/path/to/config.txt", ["config.txt"])).toBe(true);
  });

  it("matches a *.ext glob pattern", () => {
    expect(isExcluded("go", "/path/to/main.go", ["*.go"])).toBe(true);
    expect(isExcluded("css", "/path/Styles/style.css", ["*.css"])).toBe(true);
  });

  it("matches a mid-string glob pattern (e.g. prefix_*.txt)", () => {
    expect(isExcluded("plaintext", "/path/to/prefix_config.txt", ["prefix_*.txt"])).toBe(true);
    expect(isExcluded("plaintext", "/path/to/other_config.txt", ["prefix_*.txt"])).toBe(false);
  });

  it("returns false when nothing matches", () => {
    expect(isExcluded("javascript", "/path/to/app.js", ["makefile", "*.go"])).toBe(false);
  });

  it("returns false for an empty pattern list", () => {
    expect(isExcluded("makefile", "/path/to/Makefile", [])).toBe(false);
  });

  it("ignores non-string entries in the patterns array", () => {
    expect(isExcluded("go", "/path/to/main.go", [null, 42, "*.go"])).toBe(true);
  });

  it("does not confuse a language ID with a similar extension glob", () => {
    expect(isExcluded("typescript", "/path/to/app.ts", ["go"])).toBe(false);
  });

  it("matches case-insensitively for exact basename", () => {
    // Pattern "makefile" should match file named "Makefile"
    expect(isExcluded("makefile", "/path/to/Makefile", ["Makefile"])).toBe(true);
    expect(isExcluded("makefile", "/path/to/makefile", ["Makefile"])).toBe(true);
    expect(isExcluded("makefile", "/path/to/MAKEFILE", ["makefile"])).toBe(true);
  });

  it("matches case-insensitively for glob patterns", () => {
    expect(isExcluded("go", "/path/to/main.GO", ["*.go"])).toBe(true);
    expect(isExcluded("go", "/path/to/main.go", ["*.GO"])).toBe(true);
  });

  it("treats ? as a literal character in glob patterns, not a regex metachar", () => {
    // Without escaping, *.go? would compile to /^[^\\/]*\.go?$/ making the 'o' optional,
    // wrongly matching "main.g" and "main.go". With escaping it must NOT match those.
    expect(isExcluded("go", "/path/to/main.g", ["*.go?"])).toBe(false);
    expect(isExcluded("go", "/path/to/main.go", ["*.go?"])).toBe(false);
  });

  it("treats . as a literal character in glob patterns, not a regex metachar", () => {
    // Without escaping, *.txt would compile to /^[^\\/]*.*txt$/ making the '.' match any char.
    // That would wrongly match "filetxt" (no dot). With proper escaping it must NOT match.
    expect(isExcluded("plaintext", "/path/to/filetxt", ["*.txt"])).toBe(false);
    expect(isExcluded("plaintext", "/path/to/file.txt", ["*.txt"])).toBe(true);
  });

  it("ignores glob patterns with more than 3 wildcards (ReDoS guard)", () => {
    // Pattern with 4 stars should be skipped entirely
    expect(isExcluded("plaintext", "/path/to/a.txt", ["*a*a*a*a"])).toBe(false);
  });

  it("returns false when patterns is null or undefined", () => {
    expect(isExcluded("go", "/path/to/main.go", null)).toBe(false);
    expect(isExcluded("go", "/path/to/main.go", undefined)).toBe(false);
  });
});

describe("convertTabs", () => {
  it("replaces a single tab with the correct number of spaces", () => {
    expect(convertTabs("\thello", 2)).toBe("  hello");
    expect(convertTabs("\thello", 4)).toBe("    hello");
  });

  it("replaces multiple tabs in one line", () => {
    expect(convertTabs("\t\tindented", 2)).toBe("    indented");
  });

  it("expands inline tabs to the next tab stop (column-aware)", () => {
    // tab at col 1: needs 3 spaces to reach tab stop at col 4
    expect(convertTabs(" \t hello", 4)).toBe("     hello");
    // tab at col 3: needs 1 space to reach tab stop at col 4
    expect(convertTabs("abc\td", 4)).toBe("abc d");
    // tab at col 4: needs 4 spaces to reach the next tab stop at col 8
    expect(convertTabs("abcd\td", 4)).toBe("abcd    d");
  });

  it("returns the string unchanged when there are no tabs", () => {
    expect(convertTabs("no tabs here", 4)).toBe("no tabs here");
  });

  it("handles an empty string", () => {
    expect(convertTabs("", 4)).toBe("");
  });

  it("handles a string that is only tabs", () => {
    expect(convertTabs("\t\t\t", 2)).toBe("      ");
  });

  it("correctly tracks column position across surrogate-pair characters (emoji)", () => {
    // '😀' is a surrogate pair: char.length === 2 in UTF-16 (matches VS Code column model).
    // After the emoji, column is 2, so the tab needs 2 spaces to reach the next tab stop at 4.
    expect(convertTabs("😀\t", 4)).toBe("😀  ");
    // Two emoji before a tab: column is 4, already on a tab stop, so full tabSize spaces.
    expect(convertTabs("😀😀\t", 4)).toBe("😀😀    ");
  });
});
