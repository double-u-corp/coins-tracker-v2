import type { GetServerSideProps, NextPage } from "next";
import Head from "next/head";
import ManageCoinsView from "@/features/manage/ManageCoinsView";
import { requireAuthSSR } from "@/lib/auth";

export const getServerSideProps: GetServerSideProps = async (context) => {
  const redirect = requireAuthSSR(context);
  if (redirect) return redirect;
  return { props: {} };
};

const ManageCoinsPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Coins Tracker — Manage Coins</title>
      </Head>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Manage Coins</h1>
      <ManageCoinsView />
    </>
  );
};

export default ManageCoinsPage;
