/** A one-click starting point for a rule: a friendly label plus a ready-made pattern. */
export interface SitePreset {
  id: string;
  label: string;
  pattern: string;
  limitMinutes: number;
}

/**
 * Common time-sink sites offered in the rule dialog. Patterns are matched
 * anywhere in the page URL and are meant as editable starting points.
 */
export const SITE_PRESETS: SitePreset[] = [
  { id: 'youtube-shorts', label: 'YouTube Shorts', pattern: 'youtube\\.com/shorts', limitMinutes: 10 },
  { id: 'x', label: 'X', pattern: 'https?://(\\w+\\.)?x\\.com', limitMinutes: 15 },
  { id: 'instagram', label: 'Instagram', pattern: 'instagram\\.com', limitMinutes: 15 },
  { id: 'reddit', label: 'Reddit', pattern: 'reddit\\.com', limitMinutes: 20 },
  { id: 'tiktok', label: 'TikTok', pattern: 'tiktok\\.com', limitMinutes: 10 },
  { id: 'facebook', label: 'Facebook', pattern: 'facebook\\.com', limitMinutes: 15 },
];
