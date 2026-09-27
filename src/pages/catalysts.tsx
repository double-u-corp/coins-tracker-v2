import type { NextPage } from "next";
import Head from "next/head";
import CatalystsView from "@/features/catalysts/CatalystsView";

const CatalystsPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Coins Tracker — Calendar</title>
      </Head>
      <CatalystsView />
    </>
  );
};

export default CatalystsPage;
