import type { NextPage } from "next";
import Head from "next/head";
import LoginForm from "@/features/auth/LoginForm";

const LoginPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Coins Tracker — Log in</title>
      </Head>
      <LoginForm />
    </>
  );
};

export default LoginPage;
