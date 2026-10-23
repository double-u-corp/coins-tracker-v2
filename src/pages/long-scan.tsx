import type { NextPage } from "next";
import Head from "next/head";
import LongScanView from "@/features/longScan/LongScanView";

const LongScanPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Daily LONG scan · Coins Tracker</title>
      </Head>
      <LongScanView />
    </>
  );
};

export default LongScanPage;
