import type { GetServerSideProps, NextPage } from "next";
import Head from "next/head";
import TradeView from "@/features/trade/TradeView";
import { requireAuthSSR } from "@/lib/auth";

export const getServerSideProps: GetServerSideProps = async (context) => {
  const redirect = requireAuthSSR(context);
  if (redirect) return redirect;
  return { props: {} };
};

const TradePage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Coins Tracker — Buy / Sell</title>
      </Head>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Buy / Sell</h1>
      <TradeView />
    </>
  );
};

export default TradePage;
