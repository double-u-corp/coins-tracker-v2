import type { NextApiRequest, NextApiResponse } from "next";
import { isAuthenticatedRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ authenticated: boolean }>) {
  return res.status(200).json({ authenticated: isAuthenticatedRequest(req) });
}
