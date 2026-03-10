// vitest globals (describe, it, expect) are injected via globals:true in vitest.config.mjs
const { convertTabs } = require('../src/removeTabsOnSave.js');

describe('convertTabs', () => {
  it('replaces a single tab with the correct number of spaces', () => {
    expect(convertTabs('\thello', 2)).toBe('  hello');
    expect(convertTabs('\thello', 4)).toBe('    hello');
  });

  it('replaces multiple tabs in one line', () => {
    expect(convertTabs('\t\tindented', 2)).toBe('    indented');
  });

  it('expands inline tabs to the next tab stop (column-aware)', () => {
    // tab at col 1: needs 3 spaces to reach tab stop at col 4
    expect(convertTabs(' \t hello', 4)).toBe('     hello');
    // tab at col 3: needs 1 space to reach tab stop at col 4
    expect(convertTabs('abc\td', 4)).toBe('abc d');
    // tab at col 4: needs 4 spaces to reach the next tab stop at col 8
    expect(convertTabs('abcd\td', 4)).toBe('abcd    d');
  });

  it('returns the string unchanged when there are no tabs', () => {
    expect(convertTabs('no tabs here', 4)).toBe('no tabs here');
  });

  it('handles an empty string', () => {
    expect(convertTabs('', 4)).toBe('');
  });

  it('handles a string that is only tabs', () => {
    expect(convertTabs('\t\t\t', 2)).toBe('      ');
  });
});
