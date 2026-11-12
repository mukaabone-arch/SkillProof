-- Phone verification is required only in India; this records where a candidate uses MyAmbii from.
ALTER TABLE "User" ADD COLUMN "country" TEXT;
