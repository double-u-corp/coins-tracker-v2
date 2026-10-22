import Head from "next/head";
import Layout from "@/components/Layout";
import LongScanView from "@/features/longScan/LongScanView";

export default function LongScanPage() {
  return (
    <>
      <Head>
        <title>Daily LONG scan · Coins Tracker</title>
      </Head>
      <LongScanView />
    </>
  );
}
