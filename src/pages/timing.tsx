import type { NextPage } from "next";
import Head from "next/head";
import SwingTimingView from "@/features/swingTiming/SwingTimingView";

const TimingPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Swing Timing — when polls move most</title>
      </Head>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">Swing Timing</h1>
      <p className="mb-6 text-sm text-gray-500">
        Which of your scheduled price checks tends to swing more — so you know calmer vs noisier
        windows for entries.
      </p>
      <SwingTimingView />
    </>
  );
};

export default TimingPage;
