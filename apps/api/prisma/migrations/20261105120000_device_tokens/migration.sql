-- Push notifications phase 1: device tokens (no sending yet). token is unique
-- globally (a device, not a person) so re-registration under another account
-- moves the row; see DeviceToken in schema.prisma.
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
