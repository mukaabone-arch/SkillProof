-- Every row got a code from the backfill in the previous migration, and
-- OrgsService.create generates one via nextval('organization_code_seq')
-- for every row since — safe to enforce NOT NULL at the DB level now.
ALTER TABLE "Organization" ALTER COLUMN "code" SET NOT NULL;
