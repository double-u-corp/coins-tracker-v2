import { useEffect } from "react";
import { useRouter } from "next/router";
import type { NextPage } from "next";

/** LONG-scan page retired — monitor board lives on Home (manual bulk scan). */
const LongScanPage: NextPage = () => {
  const router = useRouter();
  useEffect(() => {
    void router.replace("/");
  }, [router]);
  return (
    <p className="p-6 text-sm text-slate-600">
      LONG scan moved to Home → Monitor board. Redirecting…
    </p>
  );
};

export default LongScanPage;
