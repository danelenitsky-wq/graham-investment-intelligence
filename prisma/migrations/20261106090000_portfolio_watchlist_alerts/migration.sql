-- CreateEnum
CREATE TYPE "FxRateKind" AS ENUM ('OFFICIAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CSV', 'PDF_STATEMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertRunTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'SCRIPT');

-- AlterEnum (PostgreSQL 12+ allows several ADD VALUE in one migration)
ALTER TYPE "AlertType" ADD VALUE 'GRAHAM_PURCHASE_THRESHOLD';
ALTER TYPE "AlertType" ADD VALUE 'CUSTOM_TARGET_PRICE';
ALTER TYPE "AlertType" ADD VALUE 'MARGIN_OF_SAFETY_TARGET';
ALTER TYPE "AlertType" ADD VALUE 'NEW_FILING';
ALTER TYPE "AlertType" ADD VALUE 'CURRENT_RATIO_DETERIORATION';
ALTER TYPE "AlertType" ADD VALUE 'DEBT_INCREASE';
ALTER TYPE "AlertType" ADD VALUE 'EARNINGS_DETERIORATION';
ALTER TYPE "AlertType" ADD VALUE 'DIVIDEND_INTERRUPTION';
ALTER TYPE "AlertType" ADD VALUE 'NET_NET_CHANGE';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "state" JSONB;

-- AlterTable
ALTER TABLE "PortfolioTransaction" ADD COLUMN     "importBatchId" TEXT;

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "costInputUnit" TEXT,
ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "securityType" "AssetType";

-- AlterTable
ALTER TABLE "QuoteSnapshot" ADD COLUMN     "enteredPrice" DECIMAL(20,6),
ADD COLUMN     "enteredUnit" TEXT,
ADD COLUMN     "isManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceLabel" TEXT;

-- AlterTable
ALTER TABLE "WatchlistItem" ADD COLUMN     "marginOfSafetyTarget" DOUBLE PRECISION,
ADD COLUMN     "targetCurrency" TEXT,
ADD COLUMN     "targetPrice" DECIMAL(20,6),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "rateDate" DATE NOT NULL,
    "kind" "FxRateKind" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "fetchId" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "fileName" TEXT,
    "contentHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "securityId" TEXT,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "observedValue" DECIMAL(30,6),
    "threshold" DECIMAL(30,6),
    "runId" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRun" (
    "id" TEXT NOT NULL,
    "trigger" "AlertRunTrigger" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "checked" INTEGER NOT NULL DEFAULT 0,
    "newEvents" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "providerCalls" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,

    CONSTRAINT "AlertRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FxRate_base_quote_rateDate_idx" ON "FxRate"("base", "quote", "rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_base_quote_rateDate_sourceKey_key" ON "FxRate"("base", "quote", "rateDate", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "AlertEvent_dedupeKey_key" ON "AlertEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "AlertEvent_triggeredAt_idx" ON "AlertEvent"("triggeredAt");

-- CreateIndex
CREATE INDEX "AlertEvent_securityId_triggeredAt_idx" ON "AlertEvent"("securityId", "triggeredAt");

-- CreateIndex
CREATE INDEX "AlertRun_trigger_startedAt_idx" ON "AlertRun"("trigger", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_securityId_type_key" ON "Alert"("securityId", "type");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AlertRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

