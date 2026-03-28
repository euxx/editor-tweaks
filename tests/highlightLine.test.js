// vitest globals (describe, it, expect) are injected via globals:true in vitest.config.mjs
const { getDecorationOptions, withAlpha } = require("../src/highlightLine.js");

/** Helper to build a minimal config mock */
function makeConfig(values) {
  return {
    get(key, defaultValue) {
      return key in values ? values[key] : defaultValue;
    },
  };
}

describe("getDecorationOptions", () => {
  it("returns null when enable is false", () => {
    const config = makeConfig({ enable: false, borderColor: "#65EAB9" });
    expect(getDecorationOptions(config)).toBeNull();
  });

  it("returns null when borderColor is empty", () => {
    const config = makeConfig({ enable: true, borderColor: "" });
    expect(getDecorationOptions(config)).toBeNull();
  });

  it("returns decoration options when enabled with a color", () => {
    const config = makeConfig({
      enable: true,
      borderColor: "#65EAB9",
      borderStyle: "solid",
      borderWidth: "1px",
    });
    const options = getDecorationOptions(config);
    expect(options).not.toBeNull();
    expect(options.isWholeLine).toBe(true);
    expect(options.borderColor).toBe("#65EAB9");
    expect(options.borderStyle).toBe("solid");
    expect(options.borderWidth).toBe("0 0 1px 0");
  });

  it("applies borderWidth only to the bottom edge", () => {
    const config = makeConfig({
      enable: true,
      borderColor: "#fff",
      borderStyle: "dashed",
      borderWidth: "2px",
    });
    const options = getDecorationOptions(config);
    expect(options.borderWidth).toBe("0 0 2px 0");
  });
});

describe("withAlpha", () => {
  it("converts #RRGGBB hex to rgba with the given alpha", () => {
    expect(withAlpha("#65EAB9", 0.4)).toBe("rgba(101, 234, 185, 0.4)");
  });

  it("converts #RGB shorthand by expanding it", () => {
    expect(withAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });

  it("converts #RRGGBBAA by multiplying embedded alpha with the override", () => {
    // #65EAB9FF: A = 0xFF = 1.0, so 1.0 * 0.7 = 0.7
    expect(withAlpha("#65EAB9FF", 0.7)).toBe("rgba(101, 234, 185, 0.7)");
    // #65EAB9B3: A = 0xB3 = 179/255 ≈ 0.702, so 0.702 * 0.7 ≈ 0.491
    expect(withAlpha("#65EAB9B3", 0.7)).toBe("rgba(101, 234, 185, 0.491)");
  });

  it("passes through non-hex values unchanged", () => {
    expect(withAlpha("red", 0.4)).toBe("red");
    expect(withAlpha("rgba(0,0,0,1)", 0.4)).toBe("rgba(0,0,0,1)");
  });

  it("passes through invalid hex lengths unchanged", () => {
    expect(withAlpha("#ff", 0.4)).toBe("#ff");
    expect(withAlpha("#fffff", 0.4)).toBe("#fffff");
  });

  it("passes through hex strings containing non-hex characters unchanged", () => {
    // Exercises the !/^[0-9a-f]{6}$/i validation guard.
    // #xyz — 3-digit path: replace expands only valid hex chars; 'xyz' stay as-is,
    // resulting rgb is still 3 chars and fails the 6-char guard.
    expect(withAlpha("#xyz", 1)).toBe("#xyz");
    // #GG0000 — 6-digit path: 'GG' is not in [0-9a-f], guard fires.
    expect(withAlpha("#GG0000", 1)).toBe("#GG0000");
  });
});
