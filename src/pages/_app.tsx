import type { AppProps } from "next/app";
import Layout from "@/components/Layout";
import { AuthProvider } from "@/features/auth/useAuth";
import "@/styles/globals.css";
import "@/styles/theme.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </AuthProvider>
  );
}