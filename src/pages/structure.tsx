import type { NextPage } from "next";
import Head from "next/head";
import PastTradeView from "@/features/pastTrade/PastTradeView";

const ChartPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Past Trade — 3h Fast Trade Signal</title>
      </Head>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Price Chart</h1>
      <PastTradeView />
    </>
  );
};

export default ChartPage;
