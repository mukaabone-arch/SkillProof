/**
 * Turns one of docs/*-guide.md into what the help assistant needs: the
 * guide body (everything from the first `## ` heading, same cut
 * apps/web/lib/helpGuideSource.ts makes for the /help pages) and the list of
 * linkable sections — every `##`/`###` heading carrying an explicit
 * `{#id}` anchor, which is the id the web page renders, so an answer's
 * sources link straight to /help/<audience>#<id>.
 *
 * Pure (no fs) so scripts/sync-help-guides.ts and the drift spec share it.
 */
export interface HelpGuideSection {
  id: string;
  label: string;
}

export interface HelpGuide {
  markdown: string;
  sections: HelpGuideSection[];
}

const HEADING_WITH_ID_RE = /^#{2,3}(?!#)\s+(.+?)\s*\{#([\w-]+)\}\s*$/gm;

export function parseHelpGuide(raw: string): HelpGuide {
  const text = raw.replace(/\r\n/g, '\n');
  const firstHeading = text.indexOf('\n## ');
  const markdown = (firstHeading === -1 ? text : text.slice(firstHeading + 1)).trim() + '\n';
  const sections = Array.from(markdown.matchAll(HEADING_WITH_ID_RE), (m) => ({ label: m[1], id: m[2] }));
  return { markdown, sections };
}

/**
 * iOS copy of a guide with every sentence about paid plans removed — App
 * Store guideline 3.1.1/3.1.3 (no Premium, prices or purchase talk in the
 * iOS app; see the mobile app's lib/core/store_policy.dart). The assistant's
 * system prompt also forbids the topic on iOS; this makes sure the model
 * never has that text to repeat in the first place. Headings are kept, so
 * section ids stay valid; a list item or table row that matches is dropped
 * whole.
 */
const PAID_PLAN_RE = /\b(paid plans?|premium|upgrad\w*|purchas\w*|pric(e|es|ing)|subscri\w*)|₹/i;

/** True when text talks about paid plans — such a library answer is never served on iOS. */
export function mentionsPaidPlans(text: string): boolean {
  return PAID_PLAN_RE.test(text);
}

export function withoutPaidPlanMentions(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      if (/^#{1,6}\s/.test(line) || !PAID_PLAN_RE.test(line)) return line;
      if (/^\s*([-*]\s|\d+\.\s|\|)/.test(line)) return null;
      const kept = line.split(/(?<=[.!?])\s+(?=[A-Z*])/).filter((s) => !PAID_PLAN_RE.test(s));
      return kept.length ? kept.join(' ') : null;
    })
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
