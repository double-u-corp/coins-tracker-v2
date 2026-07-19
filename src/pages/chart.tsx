import type { NextPage } from "next";
import Head from "next/head";
import ChartView from "@/features/chart/ChartView";

const ChartPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Coins Tracker — Chart</title>
      </Head>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Price Chart</h1>
      <ChartView />
    </>
  );
};

export default ChartPage;
