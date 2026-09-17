/** Every foreground/background token pair used in the UI must meet WCAG AAA (7:1). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries(
  [...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
);

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const pairs: [string, string][] = [
  ['fg', 'bg'],
  ['fg', 'bg-2'],
  ['fg', 'surface'],
  ['fg', 'surface-2'],
  ['fg', 'input'],
  ['muted', 'bg'],
  ['muted', 'bg-2'],
  ['muted', 'surface'],
  ['muted', 'input'],
  ['accent-text', 'bg'],
  ['accent-text', 'surface'],
  ['accent-text', 'surface-2'],
  ['ok', 'surface'],
  ['bad', 'surface'],
  ['accent-fg', 'accent'],
  ['accent-fg', 'accent-2'],
  ['accent-fg', 'ok-bg'],
  ['accent-fg', 'bad-bg'],
];

describe('design tokens', () => {
  it('defines every token used in the pairs', () => {
    for (const p of pairs.flat()) expect(tokens[p], p).toMatch(/^#/);
  });
  it.each(pairs)('%s on %s ≥ 7:1', (fg, bg) => {
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(7);
  });
  it('buzz button gradient top stop keeps white text ≥ 7:1', () => {
    expect(contrast('#ffffff', '#6d28d9')).toBeGreaterThanOrEqual(7);
  });
});
