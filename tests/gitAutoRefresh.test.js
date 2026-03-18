// vitest globals (describe, it, expect) are injected via globals:true in vitest.config.mjs
const { getRefreshInterval } = require('../src/gitAutoRefresh.js');

/** Helper to build a minimal config mock */
function makeConfig(values) {
  return {
    get(key, defaultValue) {
      return key in values ? values[key] : defaultValue;
    },
  };
}

describe('getRefreshInterval', () => {
  it('returns 0 when enable is false', () => {
    const config = makeConfig({ enable: false, intervalSec: 30 });
    expect(getRefreshInterval(config)).toBe(0);
  });

  it('returns the configured interval in milliseconds when enabled', () => {
    const config = makeConfig({ enable: true, intervalSec: 15 });
    expect(getRefreshInterval(config)).toBe(15000);
  });

  it('uses the default interval of 10000ms when intervalSec is not set', () => {
    const config = makeConfig({ enable: true });
    expect(getRefreshInterval(config)).toBe(10000);
  });

  it('returns 0 when intervalSec is 0', () => {
    const config = makeConfig({ enable: true, intervalSec: 0 });
    expect(getRefreshInterval(config)).toBe(0);
  });

  it('returns 0 when intervalSec is negative', () => {
    const config = makeConfig({ enable: true, intervalSec: -5 });
    expect(getRefreshInterval(config)).toBe(0);
  });

  it('returns the interval when enabled with minimum valid value', () => {
    const config = makeConfig({ enable: true, intervalSec: 1 });
    expect(getRefreshInterval(config)).toBe(1000);
  });
});
