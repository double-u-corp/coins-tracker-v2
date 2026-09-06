import type { NextPage } from "next";
import Head from "next/head";
import CatalystsView from "@/features/catalysts/CatalystsView";

const CatalystsPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Coins Tracker — Calendar</title>
      </Head>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Catalysts</h1>
      <CatalystsView />
    </>
  );
};

export default CatalystsPage;
