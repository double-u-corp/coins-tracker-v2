-- CreateTable
CREATE TABLE "Coin" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,

    CONSTRAINT "Coin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Record" (
    "id" SERIAL NOT NULL,
    "coinId" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "isNewHigh" BOOLEAN NOT NULL DEFAULT false,
    "isNewLow" BOOLEAN NOT NULL DEFAULT false,
    "cronLogId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "coinId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "phpAmount" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "coinAmount" DOUBLE PRECISION NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "transactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTarget" (
    "id" SERIAL NOT NULL,
    "coinId" INTEGER NOT NULL,
    "targetHigh" DOUBLE PRECISION,
    "targetLow" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronLog" (
    "id" SERIAL NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "message" TEXT,

    CONSTRAINT "CronLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" SERIAL NOT NULL,
    "coinId" INTEGER,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" SERIAL NOT NULL,
    "coinId" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT,
    "externalId" TEXT,
    "cronLogId" INTEGER,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coin_symbol_key" ON "Coin"("symbol");

-- CreateIndex
CREATE INDEX "Record_coinId_createdAt_idx" ON "Record"("coinId", "createdAt");

-- CreateIndex
CREATE INDEX "Record_cronLogId_idx" ON "Record"("cronLogId");

-- CreateIndex
CREATE INDEX "Transaction_coinId_transactedAt_idx" ON "Transaction"("coinId", "transactedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceTarget_coinId_key" ON "PriceTarget"("coinId");

-- CreateIndex
CREATE INDEX "JournalEntry_coinId_entryDate_idx" ON "JournalEntry"("coinId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_externalId_key" ON "NewsItem"("externalId");

-- CreateIndex
CREATE INDEX "NewsItem_coinId_publishedAt_idx" ON "NewsItem"("coinId", "publishedAt");

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_cronLogId_fkey" FOREIGN KEY ("cronLogId") REFERENCES "CronLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTarget" ADD CONSTRAINT "PriceTarget_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_cronLogId_fkey" FOREIGN KEY ("cronLogId") REFERENCES "CronLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
