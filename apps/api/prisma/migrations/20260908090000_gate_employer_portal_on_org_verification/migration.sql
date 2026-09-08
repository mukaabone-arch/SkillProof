-- Organization.verificationStatus becomes a real access gate as of this
-- deploy (OrgVerifiedGuard, wired onto Jobs/Shortlist/Applicants/Find
-- Candidates/Billing/Dashboard) — previously it gated nothing. The
-- add_org_verification migration (2026-08-25) already backfilled every org
-- that existed at that time to VERIFIED, so this only touches orgs created
-- since then that never got reviewed (still UNVERIFIED/PENDING/REJECTED).
-- Without this, those orgs would be locked out of their own portal the
-- moment this deploy lands, having done nothing wrong.
--
-- Reports the row count it actually touches (a plain UPDATE gives no
-- visible count outside a client that prints "UPDATE n") — same reasoning
-- as the org_count guard in add_org_verification, just for visibility
-- instead of correctness.
DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE "Organization"
  SET "verificationStatus" = 'VERIFIED', "verifiedAt" = now()
  WHERE "verificationStatus" != 'VERIFIED';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'gate_employer_portal_on_org_verification: backfilled % organization row(s) to VERIFIED', affected;
END $$;
