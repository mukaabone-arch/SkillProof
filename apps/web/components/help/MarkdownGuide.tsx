/**
 * Renders one of docs/candidate-guide.md or employer-guide.md's markdown
 * live, in place of the hand-transcribed CandidateHelpGuide.tsx/
 * EmployerHelpGuide.tsx this replaced (2026-09) — see helpGuideSource.ts's
 * own doc comment for why. The only structural translation needed is the
 * GST/legal-table wrapper div both guides' Statuses/Cost tables relied on
 * (`lp-legal-table-wrap` > `table.lp-legal-table`) — every other element
 * (h2/h3/p/ul/ol/strong/a) already inherits correct styling from the
 * `.lp-legal-body` class on this component's parent (HelpGuidePage's
 * `<article>`), same as the transcribed version did.
 *
 * Server Component on purpose (no 'use client') — this used to be one only
 * because its old parent, HelpTabs, needed useSearchParams for tab state.
 * That parent is gone (2026-09, /help split into /help/candidate and
 * /help/employer); nothing left in this file touches a hook or a browser
 * API, and neither react-markdown nor remark-gfm ships its own 'use client'
 * directive. Keeping this a server component means the two guide routes
 * carry zero client JS of their own — react-markdown's parse cost is paid
 * once at build time, not shipped to and re-run in every visitor's browser.
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
