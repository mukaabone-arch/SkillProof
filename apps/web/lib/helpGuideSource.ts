import fs from 'fs';
import path from 'path';

export interface HelpSection {
  id: string;
  label: string;
}

export interface HelpGuideSource {
  markdown: string;
  sections: HelpSection[];
}

/**
 * Exactly two leading `#`s, not three — `###` sub-headings (e.g.
 * "### Certifications {#certifications}") are real anchors in the body
 * text but were never part of the hand-maintained CANDIDATE_HELP_SECTIONS/
 * EMPLOYER_HELP_SECTIONS table-of-contents this replaces, and the `(?!#)`
 * keeps it that way — a bare `^##` would otherwise also match the first
 * two characters of a `###` line.
 */
const H2_WITH_ID_RE = /^##(?!#)\s+(.+?)\s*\{#([\w-]+)\}\s*$/gm;

function parseSections(markdown: string): HelpSection[] {
  return Array.from(markdown.matchAll(H2_WITH_ID_RE), (match) => ({ label: match[1], id: match[2] }));
}

/**
 * Loads one of docs/*.md (candidate-guide.md, employer-guide.md) as the
 * live source for /help/candidate and /help/employer — see
 * CandidateHelpGuide.tsx's git history for the hand-transcription this
 * replaced (2026-09), which drifted from its own source twice. `sections`
 * is parsed straight from the file's own h2 `{#id}` anchors rather than a
 * second, separately-maintained array, so the table of contents can never
 * list a section the body doesn't have (or vice versa) again.
 *
 * The file's own leading `# Title` and intro paragraph are dropped — each
 * route already renders its own heading (HelpGuidePage's `title` prop)
 * immediately above this content, so the doc's own title would be a
 * visible duplicate. Everything from the first `##` onward is kept as-is.
 *
 * Reads from disk on every call (no caching) — this is a Server Component
 * data source called once per request for a statically-generated page, not
 * a hot path; simplicity here matters more than shaving a filesystem read.
 */
export function loadHelpGuide(filename: 'candidate-guide.md' | 'employer-guide.md'): HelpGuideSource {
  const filePath = path.join(process.cwd(), '..', '..', 'docs', filename);
  const raw = fs.readFileSync(filePath, 'utf8');
  const firstHeadingIndex = raw.indexOf('\n## ');
  const markdown = firstHeadingIndex === -1 ? raw : raw.slice(firstHeadingIndex + 1);
  return { markdown, sections: parseSections(markdown) };
}
