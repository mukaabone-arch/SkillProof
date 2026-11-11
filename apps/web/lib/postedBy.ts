/**
 * Who a job is from, for candidates. The API sends orgName (the employer, or
 * the recruiting agency for an agency posting) and postedFor (the client's
 * name, "a confidential client", or null for an employer's own job). It
 * never sends a hidden client's name, so this only joins the two.
 */
export interface PostedByFields {
  orgName: string;
  postedFor?: string | null;
}

export function postedByText(job: PostedByFields): string {
  return job.postedFor ? `${job.orgName} for ${job.postedFor}` : job.orgName;
}
