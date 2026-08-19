-- One SpeakingSession per user per local calendar day (AC-I2).
--
-- `dateKey` is `YYYY-MM-DD` computed in the user's local day, not a timestamp:
-- a DATE derived server-side from `startedAt` would flip "today" at 08:00 local.
-- NOT NULL without a default is safe here because the daily-speaking tables
-- have never been released — nothing is writing rows yet.
ALTER TABLE "SpeakingSession" ADD COLUMN     "dateKey" VARCHAR(10) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingSession_userId_dateKey_key" ON "SpeakingSession"("userId", "dateKey");
