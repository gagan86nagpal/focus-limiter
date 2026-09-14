import type { Rule, RuleInput } from './types';

export const MAX_RULES = 10;
export const MAX_PATTERN_LENGTH = 200;
export const MIN_LIMIT_MINUTES = 1;
export const MAX_LIMIT_MINUTES = 1440;

export const ERRORS = {
  patternRequired: 'Enter a URL pattern',
  patternTooLong: `Pattern must be ${MAX_PATTERN_LENGTH} characters or fewer`,
  patternInvalid: 'Invalid regular expression',
  limitInvalid: `Enter a whole number between ${MIN_LIMIT_MINUTES} and ${MAX_LIMIT_MINUTES}`,
  tooManyRules: `You can have at most ${MAX_RULES} rules`,
  ruleNotFound: 'This rule no longer exists',
} as const;

/** Compiles a pattern, returning null when it is not a valid regular expression. */
export function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

export type PatternTestResult = 'empty' | 'invalid' | 'no-url' | 'match' | 'no-match';

/** Live feedback for the rule form's pattern + test URL pair. */
export function testPattern(pattern: string, url: string): PatternTestResult {
  const trimmed = pattern.trim();
  if (trimmed === '') return 'empty';
  const regex = compilePattern(trimmed);
  if (regex === null) return 'invalid';
  if (url.trim() === '') return 'no-url';
  return regex.test(url.trim()) ? 'match' : 'no-match';
}

/** True when the rule's pattern is found anywhere in the URL. */
export function ruleMatches(rule: Pick<Rule, 'pattern'>, url: string): boolean {
  const regex = compilePattern(rule.pattern);
  return regex !== null && regex.test(url);
}

/** Only ordinary web pages are tracked; extension and browser pages are ignored. */
export function isTrackableUrl(url: string | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

export interface RuleErrors {
  pattern?: string;
  limitMinutes?: string;
}

export type ValidationResult =
  | { ok: true; value: RuleInput }
  | { ok: false; errors: RuleErrors; message: string };

/** Validates and normalises form input. Never throws. */
export function validateRuleInput(input: { pattern: unknown; limitMinutes: unknown }): ValidationResult {
  const problems: Array<[keyof RuleErrors, string]> = [];
  const pattern = typeof input.pattern === 'string' ? input.pattern.trim() : '';

  if (pattern === '') {
    problems.push(['pattern', ERRORS.patternRequired]);
  } else if (pattern.length > MAX_PATTERN_LENGTH) {
    problems.push(['pattern', ERRORS.patternTooLong]);
  } else if (compilePattern(pattern) === null) {
    problems.push(['pattern', ERRORS.patternInvalid]);
  }

  const limitMinutes = Number(input.limitMinutes);
  if (
    !Number.isInteger(limitMinutes) ||
    limitMinutes < MIN_LIMIT_MINUTES ||
    limitMinutes > MAX_LIMIT_MINUTES
  ) {
    problems.push(['limitMinutes', ERRORS.limitInvalid]);
  }

  const first = problems[0];
  if (first !== undefined) {
    const errors: RuleErrors = {};
    for (const [field, message] of problems) errors[field] = message;
    return { ok: false, errors, message: first[1] };
  }
  return { ok: true, value: { pattern, limitMinutes } };
}

/** Seconds a rule allows per day. */
export function limitSeconds(rule: Pick<Rule, 'limitMinutes'>): number {
  return rule.limitMinutes * 60;
}
