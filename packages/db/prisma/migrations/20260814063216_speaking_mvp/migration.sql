-- CreateEnum
CREATE TYPE "SpeakingSessionStatus" AS ENUM ('NOT_STARTED', 'WARMUP', 'SPEAKING', 'SCORING', 'RETRY', 'COMPLETED', 'FAILED', 'DEGRADED');

-- CreateEnum
CREATE TYPE "SpeakingWinnerType" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "SpeakingRetryState" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SpeakingSentenceKind" AS ENUM ('warmup', 'paraphrase');

-- CreateTable
CREATE TABLE "SpeakingPrompt" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "warmupSentence" TEXT NOT NULL,
    "modelAudioKey" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "sort" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakingPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakingWord" (
    "id" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "ipa" TEXT NOT NULL,
    "phonemes" JSONB NOT NULL,
    "audioKey" TEXT,
    "gloss" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakingWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakingPromptWord" (
    "promptId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SpeakingPromptWord_pkey" PRIMARY KEY ("promptId","wordId")
);

-- CreateTable
CREATE TABLE "SpeakingSentence" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "audioKey" TEXT,
    "kind" "SpeakingSentenceKind" NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SpeakingSentence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "status" "SpeakingSessionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "audioKey" TEXT,
    "durationMs" INTEGER,
    "transcript" TEXT,
    "winnerType" "SpeakingWinnerType",
    "winnerPayload" JSONB,
    "retryAudioKey" TEXT,
    "retryState" "SpeakingRetryState" NOT NULL DEFAULT 'PENDING',
    "degradedFlag" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakingDailyCompletion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sessionId" TEXT NOT NULL,
    "winnerType" "SpeakingWinnerType",
    "retryState" "SpeakingRetryState" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakingDailyCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingPrompt_slug_key" ON "SpeakingPrompt"("slug");

-- CreateIndex
CREATE INDEX "SpeakingPrompt_isActive_sort_idx" ON "SpeakingPrompt"("isActive", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingWord_lemma_key" ON "SpeakingWord"("lemma");

-- CreateIndex
CREATE INDEX "SpeakingPromptWord_wordId_idx" ON "SpeakingPromptWord"("wordId");

-- CreateIndex
CREATE INDEX "SpeakingSentence_promptId_kind_sort_idx" ON "SpeakingSentence"("promptId", "kind", "sort");

-- CreateIndex
CREATE INDEX "SpeakingSession_userId_startedAt_idx" ON "SpeakingSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "SpeakingSession_promptId_idx" ON "SpeakingSession"("promptId");

-- CreateIndex
CREATE INDEX "SpeakingSession_status_idx" ON "SpeakingSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingDailyCompletion_sessionId_key" ON "SpeakingDailyCompletion"("sessionId");

-- CreateIndex
CREATE INDEX "SpeakingDailyCompletion_userId_date_idx" ON "SpeakingDailyCompletion"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakingDailyCompletion_userId_date_key" ON "SpeakingDailyCompletion"("userId", "date");

-- AddForeignKey
ALTER TABLE "SpeakingPromptWord" ADD CONSTRAINT "SpeakingPromptWord_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "SpeakingPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingPromptWord" ADD CONSTRAINT "SpeakingPromptWord_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "SpeakingWord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingSentence" ADD CONSTRAINT "SpeakingSentence_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "SpeakingPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingSession" ADD CONSTRAINT "SpeakingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingSession" ADD CONSTRAINT "SpeakingSession_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "SpeakingPrompt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingDailyCompletion" ADD CONSTRAINT "SpeakingDailyCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakingDailyCompletion" ADD CONSTRAINT "SpeakingDailyCompletion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SpeakingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
