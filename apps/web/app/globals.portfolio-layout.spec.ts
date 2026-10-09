/**
 * The two-column layout and the card-edge-alignment fix for the candidate's
 * own portfolio page are pure CSS (main.container-standard .portfolio-view
 * in globals.css) — jsdom has no CSS engine, so there is no computed grid
 * or media query to assert against via rendering. This reads the actual
 * stylesheet instead, which is the honest way to pin "two columns above
 * the 900px breakpoint, one below it, at the exact same breakpoint the
 * rest of the app's two-column pages use" and "the card no longer insets
 * itself" — exactly what would silently regress if someone changed the
 * rule, the breakpoint, or the selector's scope later.
 */
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(__dirname, 'globals.css'), 'utf8');

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The first `selector { ... }` in the file, `selector` given as plain CSS
 * text (e.g. ".portfolio-view" or "main.container-standard .portfolio-view"
 * — not pre-escaped). Every selector this spec looks up is defined once at
 * the top level and, for .portfolio-view and main.container-standard
 * .portfolio-view, again inside an @media block further down — `.match`
 * without the global flag returns the first (i.e. top-level) occurrence,
 * since this file always states a rule before its own media-query
 * override, never after.
 */
function firstRule(selector: string): string {
  const match = css.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`No rule found for ${selector}`);
  return match[1];
}

/** The breakpoint (px) of whichever @media (max-width: Npx) block's body contains `needle` (plain CSS text). */
function breakpointContaining(needle: string): number {
  const match = css.match(new RegExp(`@media \\(max-width:\\s*(\\d+)px\\)\\s*\\{[^}]*?${escapeRegExp(needle)}`));
  if (!match) throw new Error(`No @media block contains ${needle}`);
  return Number(match[1]);
}

describe('portfolio page layout — globals.css', () => {
  it('scopes the override to main.container-standard, not the base .portfolio-view rule the employer-facing view still relies on', () => {
    // The base rule (still 640px, flex, inset) must survive unscoped —
    // EmployerPortfolioView.tsx has no container-tier class of its own and
    // depends on this cap as its only width constraint.
    const base = firstRule('.portfolio-view');
    expect(base).toMatch(/max-width:\s*640px/);
    expect(base).toMatch(/display:\s*flex/);
  });

  it('is a two-column grid above the breakpoint', () => {
    const scoped = firstRule('main.container-standard .portfolio-view');
    expect(scoped).toMatch(/display:\s*grid/);
    expect(scoped).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/);
  });

  it("un-insets the card so it shares the Approved panel's edges", () => {
    const scoped = firstRule('main.container-standard .portfolio-view');
    expect(scoped).toMatch(/max-width:\s*none/);
    expect(scoped).toMatch(/margin:\s*0\s*;/);
  });

  it('collapses to a single column at the same 900px breakpoint every other two-column page uses', () => {
    expect(breakpointContaining('main.container-standard .portfolio-view')).toBe(900);
    expect(breakpointContaining('.profile-columns')).toBe(900);
    expect(breakpointContaining('.list-page-columns')).toBe(900);
  });

  it('spans the hero, stats and contact blocks full width, so they still read as one panel', () => {
    const selectorParts = ['main.container-standard .portfolio-hero', 'main.container-standard .portfolio-stats', 'main.container-standard .portfolio-contact'];
    const selectorPattern = selectorParts.map(escapeRegExp).join('\\s*,\\s*');
    const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`));
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });

  it('caps long-form prose at the reading measure, reusing the tier token rather than a new number', () => {
    const rule = firstRule('.portfolio-prose');
    expect(rule.trim()).toBe('max-width: var(--container-reading);');
  });
});
