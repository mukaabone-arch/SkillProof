/**
 * Tiny pub-sub, same shape as tokenChangeBus.ts: the setup page changes the
 * organisation type in place (PATCH /orgs/me), with no navigation, so the
 * employer layout — which read the type once from /orgs/me — would keep the
 * old one. The layout listens here, so the sidebar's Help panel switches
 * between the employer and recruiter guide the moment the choice is saved.
 */
export type OrgType = 'EMPLOYER' | 'STAFFING';
type Listener = (type: OrgType) => void;

const listeners = new Set<Listener>();

export function onOrgTypeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitOrgTypeChange(type: OrgType): void {
  listeners.forEach((listener) => listener(type));
}
