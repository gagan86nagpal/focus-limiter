import { describe, expect, it } from 'vitest';
import { SITE_PRESETS } from '../../../src/shared/presets';
import { compilePattern, MAX_LIMIT_MINUTES, MIN_LIMIT_MINUTES, ruleMatches } from '../../../src/shared/rules';

const SAMPLE_URLS: Record<string, string> = {
  'youtube-shorts': 'https://www.youtube.com/shorts/abc123',
  x: 'https://x.com/home',
  instagram: 'https://www.instagram.com/reels/xyz',
  reddit: 'https://www.reddit.com/r/all',
  tiktok: 'https://www.tiktok.com/@user',
  facebook: 'https://www.facebook.com/feed',
};

describe('SITE_PRESETS', () => {
  it('offers a non-empty list within the rule cap', () => {
    expect(SITE_PRESETS.length).toBeGreaterThan(0);
    expect(SITE_PRESETS.length).toBeLessThanOrEqual(10);
  });

  it('has unique ids and non-empty labels', () => {
    const ids = SITE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of SITE_PRESETS) expect(preset.label.trim().length).toBeGreaterThan(0);
  });

  it('each preset compiles to a valid regex', () => {
    for (const preset of SITE_PRESETS) {
      expect(compilePattern(preset.pattern)).not.toBeNull();
    }
  });

  it('each preset has a limit within the allowed range', () => {
    for (const preset of SITE_PRESETS) {
      expect(Number.isInteger(preset.limitMinutes)).toBe(true);
      expect(preset.limitMinutes).toBeGreaterThanOrEqual(MIN_LIMIT_MINUTES);
      expect(preset.limitMinutes).toBeLessThanOrEqual(MAX_LIMIT_MINUTES);
    }
  });

  it('each preset matches a representative URL for its site', () => {
    for (const preset of SITE_PRESETS) {
      const url = SAMPLE_URLS[preset.id];
      expect(url, `missing sample URL for ${preset.id}`).toBeDefined();
      expect(ruleMatches({ pattern: preset.pattern }, url as string)).toBe(true);
    }
  });

  it('the X preset does not match unrelated hosts like box.com', () => {
    const x = SITE_PRESETS.find((p) => p.id === 'x');
    expect(ruleMatches({ pattern: x!.pattern }, 'https://box.com/files')).toBe(false);
  });
});
