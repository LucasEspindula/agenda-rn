import { getSession } from "../authz";
import { redirect } from "next/navigation";
import { LegacyApp } from "./legacy-app";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await getSession();
  if (!session?.account) redirect("/");
  if (session.account.role === "general_manager") redirect("/hub");
  return <><link rel="stylesheet" href="/legacy.css" /><LegacyApp /></>;
}
