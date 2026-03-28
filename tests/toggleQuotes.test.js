// vitest globals (describe, it, expect) are injected via globals:true in vitest.config.mjs
const { findQuotedRange, cycleQuote, transformContent } = require("../src/toggleQuotes.js");

const DEFAULT_CHARS = ['"', "'", "`"];

// ---------------------------------------------------------------------------
// cycleQuote
// ---------------------------------------------------------------------------
describe("cycleQuote", () => {
  it("advances to the next quote in the default cycle", () => {
    expect(cycleQuote('"', DEFAULT_CHARS)).toBe("'");
    expect(cycleQuote("'", DEFAULT_CHARS)).toBe("`");
    expect(cycleQuote("`", DEFAULT_CHARS)).toBe('"');
  });

  it("returns the first char when the current quote is not in the list", () => {
    expect(cycleQuote("|", DEFAULT_CHARS)).toBe('"');
  });

  it("works with a custom two-char cycle", () => {
    expect(cycleQuote('"', ['"', "'"])).toBe("'");
    expect(cycleQuote("'", ['"', "'"])).toBe('"');
  });
  it("returns the first char when chars has one entry and current quote is not in it", () => {
    // Locks the fallback behaviour: unknown quote always lands on chars[0]
    expect(cycleQuote("`", ['"'])).toBe('"');
  });
});

// ---------------------------------------------------------------------------
// transformContent
// ---------------------------------------------------------------------------
describe("transformContent", () => {
  it("returns the content unchanged when old and new quotes are the same", () => {
    expect(transformContent("hello", '"', '"')).toBe("hello");
  });

  it("does not modify content that contains neither quote", () => {
    expect(transformContent("hello world", '"', "'")).toBe("hello world");
  });

  it("unescapes the old delimiter", () => {
    // \"hi\" inside a double-quoted string → 'hi' (no escaping needed)' inside single
    expect(transformContent('\\"hi\\"', '"', "'")).toBe('"hi"');
  });

  it("escapes the new delimiter when it appears unescaped in the content", () => {
    // it's inside a double-quoted string → needs escaping when switching to single
    expect(transformContent("it's", '"', "'")).toBe("it\\'s");
  });

  it("unescapes old delimiter and escapes new delimiter in the same content", () => {
    // say \"it's\" switching from " to '
    expect(transformContent('\\"it\'s\\"', '"', "'")).toBe('"it\\\'s"');
  });

  it("preserves other escape sequences unchanged", () => {
    expect(transformContent("line\\nbreak", '"', "'")).toBe("line\\nbreak");
    expect(transformContent("tab\\there", '"', "'")).toBe("tab\\there");
    expect(transformContent("back\\\\slash", '"', "'")).toBe("back\\\\slash");
  });

  it("handles consecutive escape sequences", () => {
    // \\" means literal backslash then escaped quote; switching " → '
    // \\ stays as \\, \" becomes "
    expect(transformContent('\\\\"', '"', "'")).toBe('\\\\"');
  });

  it("switches from double to backtick", () => {
    expect(transformContent("hello `world`", '"', "`")).toBe("hello \\`world\\`");
  });
});

// ---------------------------------------------------------------------------
// findQuotedRange
// ---------------------------------------------------------------------------
describe("findQuotedRange", () => {
  it("finds a double-quoted string when cursor is inside it", () => {
    //  0123456789
    // '"hello"  '  cursor at 3 (inside)
    const result = findQuotedRange('"hello"', 3, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 0, closePos: 6, quoteChar: '"' });
  });

  it("finds the range when cursor is on the opening quote", () => {
    const result = findQuotedRange('"hello"', 0, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 0, closePos: 6, quoteChar: '"' });
  });

  it("finds the range when cursor is on the closing quote", () => {
    const result = findQuotedRange('"hello"', 6, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 0, closePos: 6, quoteChar: '"' });
  });

  it("returns null when cursor is outside any quoted string", () => {
    expect(findQuotedRange('x = "hello"', 0, DEFAULT_CHARS)).toBeNull();
    expect(findQuotedRange('x = "hello"', 2, DEFAULT_CHARS)).toBeNull();
  });

  it("finds the correct pair when there are multiple quoted strings on the line", () => {
    // 'foo' + " " + 'bar'
    // 01234567890123456789
    // "foo" "bar"
    const result = findQuotedRange('"foo" "bar"', 7, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 6, closePos: 10, quoteChar: '"' });
  });

  it("handles escaped quotes inside the string", () => {
    // "say \"hi\""  — cursor at 5 (inside)
    const result = findQuotedRange('"say \\"hi\\""', 5, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 0, closePos: 11, quoteChar: '"' });
  });

  it("finds a single-quoted string", () => {
    const result = findQuotedRange("const x = 'hello'", 13, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 10, closePos: 16, quoteChar: "'" });
  });

  it("finds a backtick-quoted string", () => {
    const result = findQuotedRange("const x = `hello`", 13, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 10, closePos: 16, quoteChar: "`" });
  });

  it("returns null for an empty line", () => {
    expect(findQuotedRange("", 0, DEFAULT_CHARS)).toBeNull();
  });

  it("returns null when the quote is unclosed", () => {
    expect(findQuotedRange('"unclosed', 3, DEFAULT_CHARS)).toBeNull();
  });

  it("finds a valid pair that follows an unclosed quote on the same line", () => {
    // Cursor is inside 'valid' — the preceding unclosed " should not block scanning.
    const result = findQuotedRange("\"unclosed 'valid'", 13, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 10, closePos: 16, quoteChar: "'" });
  });

  it("handles an empty quoted string with cursor on the opening quote", () => {
    const result = findQuotedRange('""', 0, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 0, closePos: 1, quoteChar: '"' });
  });

  it("handles an empty quoted string with cursor on the closing quote", () => {
    const result = findQuotedRange('""', 1, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 0, closePos: 1, quoteChar: '"' });
  });

  it("returns null when cursor is between two adjacent quoted strings", () => {
    // "a""b" — gap between close of first and open of second doesn't exist here,
    // but test cursor right after the first closing quote and before the second opening
    // "a" "b"   positions: 0123456
    // cursor at 3 (the space) → outside both
    expect(findQuotedRange('"a" "b"', 3, DEFAULT_CHARS)).toBeNull();
  });

  it("correctly handles \\\\ before the closing quote (the \\\\ is not an escape)", () => {
    // "\\" is a string whose only content is a single backslash (\\ = escaped backslash).
    // The closing " at index 3 is NOT escaped, so the range should span [0, 3].
    // The original britesnow extension has a bug here: it checks only one char back
    // and would incorrectly treat the " as escaped.
    //   positions: 0  1  2  3
    //              "  \  \  "
    const result = findQuotedRange('"\\\\"', 1, DEFAULT_CHARS);
    expect(result).toEqual({ openPos: 0, closePos: 3, quoteChar: '"' });
  });
});
