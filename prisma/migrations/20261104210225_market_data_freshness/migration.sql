-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'CONFLICT', 'SINGLE_SOURCE');

-- CreateEnum
CREATE TYPE "QuoteFeed" AS ENUM ('REALTIME', 'DELAYED', 'EOD', 'UNKNOWN');

-- AlterTable
ALTER TABLE "FinancialLineItem" ADD COLUMN     "splitAdjusted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- AlterTable
ALTER TABLE "Security" ADD COLUMN     "lastFilingCheckAt" TIMESTAMP(3),
ADD COLUMN     "latestFilingAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "latestFilingAccession" TEXT,
ADD COLUMN     "latestFilingDate" DATE,
ADD COLUMN     "latestFilingForm" TEXT;

-- CreateTable
CREATE TABLE "QuoteSnapshot" (
    "id" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fetchId" TEXT,
    "price" DECIMAL(20,6) NOT NULL,
    "previousClose" DECIMAL(20,6),
    "change" DECIMAL(20,6),
    "changePercent" DOUBLE PRECISION,
    "open" DECIMAL(20,6),
    "dayHigh" DECIMAL(20,6),
    "dayLow" DECIMAL(20,6),
    "volume" BIGINT,
    "marketCap" DECIMAL(24,2),
    "yearHigh" DECIMAL(20,6),
    "yearLow" DECIMAL(20,6),
    "currency" TEXT NOT NULL,
    "exchange" TEXT,
    "feed" "QuoteFeed" NOT NULL,
    "feedNote" TEXT,
    "delayMinutes" INTEGER,
    "sourceTimestamp" TIMESTAMP(3) NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionState" TEXT NOT NULL,
    "sessionDate" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationNote" TEXT,
    "payloadHash" TEXT,

    CONSTRAINT "QuoteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataVerification" (
    "id" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodType" "PeriodType",
    "fiscalYear" INTEGER,
    "fiscalPeriod" TEXT,
    "periodEnd" DATE,
    "primarySource" TEXT NOT NULL,
    "primaryValue" DECIMAL(30,6),
    "primaryReference" TEXT,
    "secondarySource" TEXT NOT NULL,
    "secondaryValue" DECIMAL(30,6),
    "secondaryReference" TEXT,
    "relDiff" DOUBLE PRECISION,
    "tolerance" DOUBLE PRECISION,
    "status" "VerificationStatus" NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DataVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteSnapshot_securityId_retrievedAt_idx" ON "QuoteSnapshot"("securityId", "retrievedAt");

-- CreateIndex
CREATE INDEX "DataVerification_securityId_dataset_resolvedAt_idx" ON "DataVerification"("securityId", "dataset", "resolvedAt");

-- CreateIndex
CREATE INDEX "DataVerification_securityId_status_idx" ON "DataVerification"("securityId", "status");

-- AddForeignKey
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_fetchId_fkey" FOREIGN KEY ("fetchId") REFERENCES "DataFetch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataVerification" ADD CONSTRAINT "DataVerification_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;
