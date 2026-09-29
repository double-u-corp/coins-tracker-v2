import type { NextPage } from "next";
import Head from "next/head";
import PastTradeView from "@/features/pastTrade/PastTradeView";

const StructurePage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Structure — 3h entry ladder (Spot companion)</title>
      </Head>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Structure</h1>
      <p className="mb-4 text-sm text-gray-500">
        Spot decides buy / wait / cash. This page only refines the entry ladder from poll prices.
      </p>
      <PastTradeView />
    </>
  );
};

export default StructurePage;
