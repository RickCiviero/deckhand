import { describe, expect, it } from 'vitest';
import { isNewer, parseVersion } from './index.js';

describe('versions', () => {
  it('parses tags and compares numerically', () => {
    expect(parseVersion('v0.1.2')).toEqual([0, 1, 2]);
    expect(parseVersion('1.10.0-beta.1')).toEqual([1, 10, 0]);
    expect(parseVersion('latest')).toBeNull();
    expect(isNewer('v0.1.10', '0.1.9')).toBe(true);
    expect(isNewer('0.2.0', '0.10.0')).toBe(false);
    expect(isNewer('0.1.2', '0.1.2')).toBe(false);
    expect(isNewer('nonsense', '0.1.2')).toBe(false);
  });
});
