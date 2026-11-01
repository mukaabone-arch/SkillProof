-- Staffing availability reminders (see StaffingAvailabilityReminderJob).
ALTER TYPE "NotificationType" ADD VALUE 'STAFFING_AVAILABILITY_REMINDER';
ALTER TABLE "CandidateProfile" ADD COLUMN "availabilityReminderSentAt" TIMESTAMP(3);
