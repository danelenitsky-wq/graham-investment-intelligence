-- AlterTable
ALTER TABLE "CorporateAction" ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- AlterTable
ALTER TABLE "FinancialLineItem" ADD COLUMN     "retrievedAt" TIMESTAMP(3),
ADD COLUMN     "sourceUrl" TEXT;
