/**
 * Suspense fallback for every /employer/* route — see .employer-skeleton-*
 * in globals.css for the shape/color reasoning. Renders inside
 * .employer-content (nested under .employer-shell, sidebar/topbar already
 * mounted and stable — see EmployerSidebarShell), so it only ever needs to
 * fill the content slot, not the whole page.
 *
 * Real impact is narrower than "primary fix" might suggest: this fires
 * while Next.js is fetching a route segment's own payload, which for an
 * already-prefetched <Link> (the normal case clicking between employer
 * tabs) resolves before this ever paints — confirmed directly, not
 * assumed, with an unmissable temporary fallback that never rendered once
 * across a full navigation in a production build. It still fires for a
 * genuinely slow/non-prefetched load (typed URL, throttled network, first
 * visit), which is worth covering on its own merits. The actual fix for
 * the tab-switch blink is in app/employer/layout.tsx (removing the
 * per-navigation `ready` reset that was tearing down and remounting the
 * content slot on every click) — see that file's own comment.
 */
const STAT_COUNT = 4;
const ROW_COUNT = 3;

export default function EmployerLoading() {
  return (
    <main className="container-wide" aria-hidden="true">
      <div className="employer-skeleton-bar employer-skeleton-heading" />
      <div className="employer-skeleton-bar employer-skeleton-subhead" />
      <div className="employer-skeleton-stats">
        {Array.from({ length: STAT_COUNT }, (_, i) => (
          <div key={i} className="employer-skeleton-stat" />
        ))}
      </div>
      <div className="employer-skeleton-rows">
        {Array.from({ length: ROW_COUNT }, (_, i) => (
          <div key={i} className="employer-skeleton-row" />
        ))}
      </div>
    </main>
  );
}
