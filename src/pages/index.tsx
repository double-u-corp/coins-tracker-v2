import type { NextPage } from "next";
import Head from "next/head";
import HomeTable from "@/features/home/HomeTable";

const HomePage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Coins Tracker — Home</title>
      </Head>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Coin Prices</h1>
      <HomeTable />
    </>
  );
};

export default HomePage;
