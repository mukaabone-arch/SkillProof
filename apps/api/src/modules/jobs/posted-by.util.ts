import { Prisma } from '@prisma/client';

/**
 * Who a job is from, as candidates see it. An employer's own job is just
 * the employer. An agency posting (hiring projects phase 2) is "<Agency> for
 * <Client>", or "<Agency> for a confidential client" when the recruiter hid
 * the client's name, which is the default.
 *
 * The confidential client's name must never reach a candidate: every
 * candidate-facing read and email goes through postedFor(), which drops it
 * when hideClientName is set. Nothing else should read postedForClient.name
 * on a candidate path.
 */
export const POSTED_BY_SELECT = {
  organization: { select: { name: true } },
  hideClientName: true,
  postedForClient: { select: { name: true } },
} satisfies Prisma.JobSelect;

export const CONFIDENTIAL_CLIENT = 'a confidential client';

export interface PostedBySource {
  organization: { name: string };
  hideClientName: boolean;
  postedForClient: { name: string } | null;
}

/** The client line for an agency posting, or null for an employer's own job. */
export function postedFor(job: PostedBySource): string | null {
  if (!job.postedForClient) return null;
  return job.hideClientName ? CONFIDENTIAL_CLIENT : job.postedForClient.name;
}

/** "Acme Corp", or "Talent Partners for Globex" / "Talent Partners for a confidential client". */
export function postedByText(job: PostedBySource): string {
  const client = postedFor(job);
  return client ? `${job.organization.name} for ${client}` : job.organization.name;
}

/** The candidate-facing fields every job payload carries. agencyPosting tells the apply screen to say who gets the candidate's details. */
export function postedByFields(job: PostedBySource) {
  const client = postedFor(job);
  return { orgName: job.organization.name, postedFor: client, agencyPosting: client !== null };
}
