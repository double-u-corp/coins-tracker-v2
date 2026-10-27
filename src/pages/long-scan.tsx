import type { GetServerSideProps, NextPage } from "next";
import Head from "next/head";
import LongScanView from "@/features/longScan/LongScanView";
import { requireAuthSSR } from "@/lib/auth";

/** SSR only — do not combine with getStaticProps / getStaticPaths. */
export const getServerSideProps: GetServerSideProps = async (context) => {
  const redirect = requireAuthSSR(context);
  if (redirect) return redirect;
  return { props: {} };
};

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
