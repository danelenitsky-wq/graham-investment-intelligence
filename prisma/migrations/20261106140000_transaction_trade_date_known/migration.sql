-- Whether PortfolioTransaction.tradeDate is a real trade date. Imports without a
-- purchase date stored the import date; such dates must not select the FX rate
-- for the historical cost basis.
ALTER TABLE "PortfolioTransaction" ADD COLUMN "tradeDateKnown" BOOLEAN NOT NULL DEFAULT true;

-- A position whose openedAt is NULL was only ever imported without purchase
-- dates (openedAt is the earliest given purchase date), so its trades' dates
-- are import dates.
UPDATE "PortfolioTransaction" t
SET "tradeDateKnown" = false
FROM "Position" p
WHERE p."portfolioId" = t."portfolioId"
  AND p."securityId" = t."securityId"
  AND p."openedAt" IS NULL;
