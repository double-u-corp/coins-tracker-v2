import { PrismaClient } from "@prisma/client";
import { DEFAULT_SEED_COINS } from "../src/lib/coinsApi";

const prisma = new PrismaClient();

async function main() {
  for (const coin of DEFAULT_SEED_COINS) {
    await prisma.coin.upsert({
      where: { symbol: coin.symbol },
      update: { name: coin.name },
      create: { symbol: coin.symbol, name: coin.name },
    });
  }
  console.log(`Seeded ${DEFAULT_SEED_COINS.length} coins.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
