import type { NextPage } from "next";
import Head from "next/head";
import HomeTable from "@/features/home/HomeTable";

const HomePage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Coins Tracker — Home</title>
      </Head>
      <HomeTable />
    </>
  );
};

export default HomePage;