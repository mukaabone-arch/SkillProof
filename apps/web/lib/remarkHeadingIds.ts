import { visit } from 'unist-util-visit';
import type { Root, Heading, Text } from 'mdast';

/**
 * Extracts a trailing `{#custom-id}` from a heading's text (the
 * kramdown/GFM heading-attribute convention docs/candidate-guide.md and
 * docs/employer-guide.md already use throughout) and applies it as the
 * rendered heading's real `id`, in place of react-markdown's default (no id
 * at all) or a rehype-slug-style auto-slug of the visible text. The docs'
 * ids are hand-chosen and don't always match a slugified heading — e.g.
 * "Free plan limits" slugifies to "free-plan-limits", not the doc's own
 * "free-limits" — and HelpTabs' table-of-contents links (and
 * helpGuideSource.ts's own section-list parser) target these exact ids, so
 * they must resolve to the same id the rendered heading actually gets.
 */
export default function remarkHeadingIds() {
  return (tree: Root) => {
    visit(tree, 'heading', (node: Heading) => {
      const last = node.children[node.children.length - 1];
      if (!last || last.type !== 'text') return;
      const match = /\s*\{#([\w-]+)\}\s*$/.exec((last as Text).value);
      if (!match) return;
      (last as Text).value = (last as Text).value.slice(0, match.index);
      node.data = { ...node.data, hProperties: { ...(node.data?.hProperties as object), id: match[1] } };
    });
  };
}
