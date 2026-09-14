import { describe, expect, it } from 'vitest';
import {
  ERRORS,
  MAX_LIMIT_MINUTES,
  MAX_PATTERN_LENGTH,
  compilePattern,
  isTrackableUrl,
  limitSeconds,
  ruleMatches,
  testPattern,
  validateRuleInput,
} from '../../../src/shared/rules';

describe('compilePattern', () => {
  it('compiles a valid regex', () => {
    expect(compilePattern('abc.*')).toBeInstanceOf(RegExp);
  });

  it('returns null for an invalid regex', () => {
    expect(compilePattern('[')).toBeNull();
  });
});

describe('testPattern', () => {
  it('is empty when the pattern is blank', () => {
    expect(testPattern('   ', 'https://x.com')).toBe('empty');
  });

  it('is invalid for a broken regex', () => {
    expect(testPattern('(', 'https://x.com')).toBe('invalid');
  });

  it('is no-url when the pattern is valid but no URL is given', () => {
    expect(testPattern('x\\.com', '   ')).toBe('no-url');
  });

  it('reports a match', () => {
    expect(testPattern('shorts', 'https://youtube.com/shorts/ab')).toBe('match');
  });

  it('reports a non-match', () => {
    expect(testPattern('shorts', 'https://youtube.com/watch')).toBe('no-match');
  });
});

describe('ruleMatches', () => {
  it('matches when the pattern appears in the URL', () => {
    expect(ruleMatches({ pattern: 'x\\.com' }, 'https://x.com/home')).toBe(true);
  });

  it('does not match a different URL', () => {
    expect(ruleMatches({ pattern: 'x\\.com' }, 'https://y.com/home')).toBe(false);
  });

  it('never matches when the pattern is invalid', () => {
    expect(ruleMatches({ pattern: '(' }, 'https://x.com')).toBe(false);
  });
});

describe('isTrackableUrl', () => {
  it('accepts http and https', () => {
    expect(isTrackableUrl('http://a.com')).toBe(true);
    expect(isTrackableUrl('https://a.com')).toBe(true);
  });

  it('rejects extension, chrome, and empty URLs', () => {
    expect(isTrackableUrl('chrome://extensions')).toBe(false);
    expect(isTrackableUrl('chrome-extension://id/page.html')).toBe(false);
    expect(isTrackableUrl(undefined)).toBe(false);
    expect(isTrackableUrl('')).toBe(false);
  });
});

describe('limitSeconds', () => {
  it('converts minutes to seconds', () => {
    expect(limitSeconds({ limitMinutes: 5 })).toBe(300);
  });
});

describe('validateRuleInput', () => {
  it('accepts and normalises a valid input', () => {
    const result = validateRuleInput({ pattern: '  youtube\\.com  ', limitMinutes: '10' });
    expect(result).toEqual({ ok: true, value: { pattern: 'youtube\\.com', limitMinutes: 10 } });
  });

  it('rejects an empty pattern', () => {
    const result = validateRuleInput({ pattern: '   ', limitMinutes: 5 });
    expect(result).toEqual({
      ok: false,
      errors: { pattern: ERRORS.patternRequired },
      message: ERRORS.patternRequired,
    });
  });

  it('rejects a non-string pattern', () => {
    const result = validateRuleInput({ pattern: 123, limitMinutes: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.pattern).toBe(ERRORS.patternRequired);
  });

  it('rejects an over-long pattern', () => {
    const result = validateRuleInput({ pattern: 'a'.repeat(MAX_PATTERN_LENGTH + 1), limitMinutes: 5 });
    if (!result.ok) expect(result.errors.pattern).toBe(ERRORS.patternTooLong);
    else throw new Error('expected failure');
  });

  it('rejects an invalid regex', () => {
    const result = validateRuleInput({ pattern: '(', limitMinutes: 5 });
    if (!result.ok) expect(result.errors.pattern).toBe(ERRORS.patternInvalid);
    else throw new Error('expected failure');
  });

  it('rejects a non-integer limit', () => {
    const result = validateRuleInput({ pattern: 'x', limitMinutes: 2.5 });
    if (!result.ok) expect(result.errors.limitMinutes).toBe(ERRORS.limitInvalid);
    else throw new Error('expected failure');
  });

  it('rejects a limit below the minimum', () => {
    const result = validateRuleInput({ pattern: 'x', limitMinutes: 0 });
    if (!result.ok) expect(result.errors.limitMinutes).toBe(ERRORS.limitInvalid);
    else throw new Error('expected failure');
  });

  it('rejects a limit above the maximum', () => {
    const result = validateRuleInput({ pattern: 'x', limitMinutes: MAX_LIMIT_MINUTES + 1 });
    if (!result.ok) expect(result.errors.limitMinutes).toBe(ERRORS.limitInvalid);
    else throw new Error('expected failure');
  });

  it('rejects a non-numeric limit', () => {
    const result = validateRuleInput({ pattern: 'x', limitMinutes: 'abc' });
    if (!result.ok) expect(result.errors.limitMinutes).toBe(ERRORS.limitInvalid);
    else throw new Error('expected failure');
  });

  it('reports both errors and takes the pattern error as the message', () => {
    const result = validateRuleInput({ pattern: '', limitMinutes: 0 });
    if (!result.ok) {
      expect(result.errors).toEqual({
        pattern: ERRORS.patternRequired,
        limitMinutes: ERRORS.limitInvalid,
      });
      expect(result.message).toBe(ERRORS.patternRequired);
    } else throw new Error('expected failure');
  });

  it('accepts the maximum limit', () => {
    const result = validateRuleInput({ pattern: 'x', limitMinutes: MAX_LIMIT_MINUTES });
    expect(result.ok).toBe(true);
  });
});
