// vitest globals (describe, it, expect) are injected via globals:true in vitest.config.mjs
const { getDecorationOptions } = require('../src/highlightLine.js');

/** Helper to build a minimal config mock */
function makeConfig(values) {
  return {
    get(key, defaultValue) {
      return key in values ? values[key] : defaultValue;
    },
  };
}

describe('getDecorationOptions', () => {
  it('returns null when enable is false', () => {
    const config = makeConfig({ enable: false, borderColor: '#65EAB9' });
    expect(getDecorationOptions(config)).toBeNull();
  });

  it('returns null when borderColor is empty', () => {
    const config = makeConfig({ enable: true, borderColor: '' });
    expect(getDecorationOptions(config)).toBeNull();
  });

  it('returns decoration options when enabled with a color', () => {
    const config = makeConfig({ enable: true, borderColor: '#65EAB9', borderStyle: 'solid', borderWidth: '1px' });
    const options = getDecorationOptions(config);
    expect(options).not.toBeNull();
    expect(options.isWholeLine).toBe(true);
    expect(options.borderColor).toBe('#65EAB9');
    expect(options.borderStyle).toBe('solid');
    expect(options.borderWidth).toBe('0 0 1px 0');
  });

  it('applies borderWidth only to the bottom edge', () => {
    const config = makeConfig({ enable: true, borderColor: '#fff', borderStyle: 'dashed', borderWidth: '2px' });
    const options = getDecorationOptions(config);
    expect(options.borderWidth).toBe('0 0 2px 0');
  });
});
