/**
 * Renders a job description with real paragraph/list structure instead of
 * one undifferentiated block. Source descriptions (both the demo fixture —
 * see apps/api/prisma/demo_jobs_clean.json — and real employer-posted ones)
 * are stored verbatim with whatever single `\n` line breaks the source had;
 * they carry no blank-line (`\n\n`) paragraph separation and, for the demo
 * fixture, no bullet markers either — `white-space: pre-wrap` alone
 * preserves the breaks but renders every line at normal line-height with no
 * visual gap between them, which is what actually reads as "a wall of
 * text." Splitting each line into its own <p> (with margin) fixes that
 * regardless of the source; grouping consecutive marker-prefixed lines
 * (-, *, •, "1.") into a real <ul> handles descriptions that do use them,
 * without inventing structure for ones that don't.
 */
type DescriptionBlock = { type: 'paragraph'; text: string } | { type: 'list'; items: string[] };

const LIST_MARKER_RE = /^(?:[-*•]|\d+[.)])\s+(.*)$/;

function parseDescriptionBlocks(description: string): DescriptionBlock[] {
  const lines = description
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const blocks: DescriptionBlock[] = [];
  for (const line of lines) {
    const match = line.match(LIST_MARKER_RE);
    if (match) {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'list') {
        last.items.push(match[1]);
      } else {
        blocks.push({ type: 'list', items: [match[1]] });
      }
    } else {
      blocks.push({ type: 'paragraph', text: line });
    }
  }
  return blocks;
}

export interface JobDescriptionProps {
  description: string;
}

export function JobDescription({ description }: JobDescriptionProps) {
  const blocks = parseDescriptionBlocks(description);
  return (
    <div>
      {blocks.map((block, i) =>
        block.type === 'list' ? (
          <ul key={i} style={{ margin: '0 0 12px', paddingLeft: 20 }}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i} style={{ margin: '0 0 12px' }}>{block.text}</p>
        ),
      )}
    </div>
  );
}
