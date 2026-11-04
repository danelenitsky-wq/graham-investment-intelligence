-- CreateEnum
CREATE TYPE "Market" AS ENUM ('US', 'IL', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('COMMON_STOCK', 'PREFERRED_STOCK', 'ADR', 'ETF', 'REIT', 'OTHER');

-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('REFERENCE', 'FUNDAMENTALS', 'PRICES', 'MACRO', 'MANUAL');

-- CreateEnum
CREATE TYPE "FetchStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "CorporateActionType" AS ENUM ('CASH_DIVIDEND', 'STOCK_SPLIT');

-- CreateEnum
CREATE TYPE "StatementType" AS ENUM ('INCOME', 'BALANCE_SHEET', 'CASH_FLOW');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('ANNUAL', 'QUARTERLY', 'TTM');

-- CreateEnum
CREATE TYPE "Methodology" AS ENUM ('GRAHAM_1973', 'MODERN_EXTENSION');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'FEE');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('PRICE_ABOVE', 'PRICE_BELOW', 'MARGIN_OF_SAFETY_ABOVE', 'GRAHAM_CRITERIA_CHANGED', 'DATA_STALE');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'TRIGGERED', 'DISABLED');

-- CreateTable
CREATE TABLE "Exchange" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "mic" TEXT,
    "name" TEXT NOT NULL,
    "nameHe" TEXT,
    "market" "Market" NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Security" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHe" TEXT,
    "assetType" "AssetType" NOT NULL DEFAULT 'COMMON_STOCK',
    "cik" TEXT,
    "isin" TEXT,
    "taseSecurityNumber" TEXT,
    "figi" TEXT,
    "sector" TEXT,
    "industry" TEXT,
    "sicCode" TEXT,
    "isUtility" BOOLEAN NOT NULL DEFAULT false,
    "reportingCurrency" TEXT,
    "fiscalYearEndMonth" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Security_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL,
    "baseUrl" TEXT,
    "termsUrl" TEXT,
    "description" TEXT,
    "isDevFixture" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataFetch" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "securityId" TEXT,
    "dataset" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" "FetchStatus" NOT NULL DEFAULT 'RUNNING',
    "httpStatus" INTEGER,
    "recordCount" INTEGER,
    "errorMessage" TEXT,
    "payloadHash" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataFetch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityIssue" (
    "id" TEXT NOT NULL,
    "securityId" TEXT,
    "sourceId" TEXT,
    "severity" "IssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DataQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBar" (
    "id" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "open" DECIMAL(20,6),
    "high" DECIMAL(20,6),
    "low" DECIMAL(20,6),
    "close" DECIMAL(20,6) NOT NULL,
    "adjClose" DECIMAL(20,6),
    "volume" BIGINT,
    "currency" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fetchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceBar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateAction" (
    "id" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "type" "CorporateActionType" NOT NULL,
    "exDate" DATE NOT NULL,
    "payDate" DATE,
    "amount" DECIMAL(20,6),
    "ratio" DECIMAL(20,8),
    "currency" TEXT,
    "sourceId" TEXT NOT NULL,
    "fetchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialStatement" (
    "id" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "statementType" "StatementType" NOT NULL,
    "periodType" "PeriodType" NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "fiscalPeriod" TEXT NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "form" TEXT,
    "accessionNumber" TEXT,
    "filedAt" DATE,
    "isRestated" BOOLEAN NOT NULL DEFAULT false,
    "sourceId" TEXT NOT NULL,
    "fetchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialLineItem" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "sourceConcept" TEXT NOT NULL,
    "value" DECIMAL(30,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "accessionNumber" TEXT,
    "filedAt" DATE,

    CONSTRAINT "FinancialLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisSnapshot" (
    "id" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "methodology" "Methodology" NOT NULL,
    "asOfDate" DATE NOT NULL,
    "priceUsed" DECIMAL(20,6),
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "dataQuality" JSONB,
    "inputsHash" TEXT NOT NULL,
    "usesDevFixtureData" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "quantity" DECIMAL(24,8) NOT NULL,
    "averageCost" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioTransaction" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "securityId" TEXT,
    "type" "TransactionType" NOT NULL,
    "tradeDate" DATE NOT NULL,
    "quantity" DECIMAL(24,8),
    "price" DECIMAL(20,6),
    "fees" DECIMAL(20,6),
    "currency" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "notes" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "securityId" TEXT,
    "type" "AlertType" NOT NULL,
    "threshold" DECIMAL(20,6),
    "params" JSONB,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastTriggeredAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_code_key" ON "Exchange"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_mic_key" ON "Exchange"("mic");

-- CreateIndex
CREATE INDEX "Security_cik_idx" ON "Security"("cik");

-- CreateIndex
CREATE INDEX "Security_isin_idx" ON "Security"("isin");

-- CreateIndex
CREATE INDEX "Security_name_idx" ON "Security"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Security_ticker_exchangeId_key" ON "Security"("ticker", "exchangeId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_key_key" ON "DataSource"("key");

-- CreateIndex
CREATE INDEX "DataFetch_sourceId_startedAt_idx" ON "DataFetch"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "DataFetch_securityId_dataset_startedAt_idx" ON "DataFetch"("securityId", "dataset", "startedAt");

-- CreateIndex
CREATE INDEX "DataQualityIssue_securityId_resolvedAt_idx" ON "DataQualityIssue"("securityId", "resolvedAt");

-- CreateIndex
CREATE INDEX "PriceBar_securityId_date_idx" ON "PriceBar"("securityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBar_securityId_date_sourceId_key" ON "PriceBar"("securityId", "date", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateAction_securityId_type_exDate_sourceId_key" ON "CorporateAction"("securityId", "type", "exDate", "sourceId");

-- CreateIndex
CREATE INDEX "FinancialStatement_securityId_periodType_fiscalYear_idx" ON "FinancialStatement"("securityId", "periodType", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialStatement_securityId_statementType_periodType_peri_key" ON "FinancialStatement"("securityId", "statementType", "periodType", "periodEnd", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialLineItem_statementId_concept_key" ON "FinancialLineItem"("statementId", "concept");

-- CreateIndex
CREATE INDEX "AnalysisSnapshot_securityId_engine_computedAt_idx" ON "AnalysisSnapshot"("securityId", "engine", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Position_portfolioId_securityId_key" ON "Position"("portfolioId", "securityId");

-- CreateIndex
CREATE INDEX "PortfolioTransaction_portfolioId_tradeDate_idx" ON "PortfolioTransaction"("portfolioId", "tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_securityId_key" ON "WatchlistItem"("watchlistId", "securityId");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "Alert"("status");

-- AddForeignKey
ALTER TABLE "Security" ADD CONSTRAINT "Security_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Security" ADD CONSTRAINT "Security_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataFetch" ADD CONSTRAINT "DataFetch_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataFetch" ADD CONSTRAINT "DataFetch_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_fetchId_fkey" FOREIGN KEY ("fetchId") REFERENCES "DataFetch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateAction" ADD CONSTRAINT "CorporateAction_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateAction" ADD CONSTRAINT "CorporateAction_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateAction" ADD CONSTRAINT "CorporateAction_fetchId_fkey" FOREIGN KEY ("fetchId") REFERENCES "DataFetch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialStatement" ADD CONSTRAINT "FinancialStatement_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialStatement" ADD CONSTRAINT "FinancialStatement_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialStatement" ADD CONSTRAINT "FinancialStatement_fetchId_fkey" FOREIGN KEY ("fetchId") REFERENCES "DataFetch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialLineItem" ADD CONSTRAINT "FinancialLineItem_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "FinancialStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSnapshot" ADD CONSTRAINT "AnalysisSnapshot_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;
