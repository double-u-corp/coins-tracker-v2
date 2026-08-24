-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_coinId_fkey";

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "coinId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
