import { getSession } from "../authz";
import { redirect } from "next/navigation";
import { LegacyApp } from "./legacy-app";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ agenda?: string }> }) {
  const session = await getSession();
  if (!session?.account) redirect("/");
  const params = await searchParams;
  if (session.account.role === "general_manager" && params.agenda !== "1") redirect("/hub");
  return <><link rel="stylesheet" href="/legacy.css" /><LegacyApp /></>;
}
