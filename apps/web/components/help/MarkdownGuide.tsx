'use client';

/**
 * Renders one of docs/candidate-guide.md or employer-guide.md's markdown
 * live, in place of the hand-transcribed CandidateHelpGuide.tsx/
 * EmployerHelpGuide.tsx this replaced (2026-09) — see helpGuideSource.ts's
 * own doc comment for why. The only structural translation needed is the
 * GST/legal-table wrapper div both guides' Statuses/Cost tables relied on
 * (`lp-legal-table-wrap` > `table.lp-legal-table`) — every other element
 * (h2/h3/p/ul/ol/strong/a) already inherits correct styling from the
 * `.lp-legal-body` class on this component's parent (HelpTabs' `<article>`),
 * same as the transcribed version did.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkHeadingIds from '@/lib/remarkHeadingIds';

export default function MarkdownGuide({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkHeadingIds]}
      components={{
        table: ({ children }) => (
          <div className="lp-legal-table-wrap">
            <table className="lp-legal-table">{children}</table>
          </div>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
