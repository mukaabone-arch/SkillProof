import { redirect, permanentRedirect } from 'next/navigation';

/**
 * /help used to render both guides behind an audience tab
 * (?audience=candidates|employers). The guides now have their own routes.
 *
 * This route exists only to keep old links working. Two kinds are in the
 * wild: bare /help (the landing footer, /faq, both portal navs — all
 * updated, but external links and bookmarks aren't) and
 * /help?audience=employers, which the tab bar generated as a real history
 * entry, so anyone who used the back button has these in their history.
 *
 * Bare /help goes to the candidate guide: the candidate path is the one
 * where someone arrives without an account, from an employer's assessment
 * request, needing to know what they're agreeing to.
 *
 * Note the fragment survives either way — headings keep their own {#id}
 * anchors from the markdown, so /help?audience=employers#seats lands on
 * /help/employer#seats with the anchor intact. The browser never sends the
 * fragment to the server; it re-applies it after the redirect.
 *
 * `permanentRedirect` (308) rather than `redirect` (307) for the bare case
 * so search engines transfer ranking to the new URL rather than
 * indefinitely re-crawling this one. The audience case uses a temporary
 * redirect — those URLs were never meant to be linked directly and there's
 * nothing to preserve.
 */
export default function HelpIndexPage({
  searchParams,
}: {
  searchParams: { audience?: string };
}) {
  if (searchParams.audience === 'employers') redirect('/help/employer');
  if (searchParams.audience === 'candidates') redirect('/help/candidate');
  permanentRedirect('/help/candidate');
}
