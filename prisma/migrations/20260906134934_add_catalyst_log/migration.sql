-- CreateTable
CREATE TABLE "CatalystLog" (
    "id" SERIAL NOT NULL,
    "promptId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalystLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalystLog_promptId_key" ON "CatalystLog"("promptId");
