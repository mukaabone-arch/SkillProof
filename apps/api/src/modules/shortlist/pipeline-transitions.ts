import { ConflictException } from '@nestjs/common';
import { ShortlistStage } from '@prisma/client';

/**
 * The full hiring-pipeline state machine for ShortlistEntry.stage, in one
 * place so every transition (employer- and candidate-initiated) is checked
 * against the same table — no ad-hoc `if (stage !== ...)` scattered across
 * two services. Each key is one caller-facing action; `from` is the set of
 * stages it's legal to fire from, `to` is the resulting stage.
 *
 * Deliberately does NOT cover InterviewRound status changes or
 * candidateResponse — those aren't stage transitions (see
 * ShortlistEntry.candidateResponse's doc comment on why the offer response
 * is a second, independent write rather than part of this table) and are
 * gated by their own simple stage === OFFER / INTERVIEWING checks at the
 * call site instead.
 */
export const PIPELINE_TRANSITIONS = {
  invite: { from: [ShortlistStage.SHORTLISTED], to: ShortlistStage.INVITED },
  acceptInvite: { from: [ShortlistStage.INVITED], to: ShortlistStage.INTERVIEWING },
  declineInvite: { from: [ShortlistStage.INVITED], to: ShortlistStage.DECLINED },
  extendOffer: { from: [ShortlistStage.INTERVIEWING], to: ShortlistStage.OFFER },
  markHired: { from: [ShortlistStage.OFFER], to: ShortlistStage.HIRED },
  markClosed: { from: [ShortlistStage.OFFER], to: ShortlistStage.CLOSED },
  // "Any active stage" = anything that isn't already a terminal one.
  reject: {
    from: [ShortlistStage.SHORTLISTED, ShortlistStage.INVITED, ShortlistStage.INTERVIEWING, ShortlistStage.OFFER],
    to: ShortlistStage.REJECTED,
  },
} as const satisfies Record<string, { from: readonly ShortlistStage[]; to: ShortlistStage }>;

export type PipelineAction = keyof typeof PIPELINE_TRANSITIONS;

/**
 * Throws 409 if `current` isn't a legal starting stage for `action`;
 * otherwise returns the stage to write. Callers do the actual
 * `prisma.shortlistEntry.update({ data: { stage: assertTransition(...) } })`
 * — this function never touches the database, so it's trivially testable
 * and reusable from both ShortlistPipelineService (employer actions) and
 * InterviewsService (candidate actions) without either depending on the
 * other's module.
 */
export function assertTransition(current: ShortlistStage, action: PipelineAction): ShortlistStage {
  const transition = PIPELINE_TRANSITIONS[action];
  if (!(transition.from as readonly ShortlistStage[]).includes(current)) {
    const allowed = transition.from.join(' or ');
    throw new ConflictException(
      `Cannot ${action} from stage ${current} — entry must be in ${allowed}.`,
    );
  }
  return transition.to;
}
