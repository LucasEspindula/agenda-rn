import { getSession } from "../authz";
import { redirect } from "next/navigation";
import { LegacyApp } from "./legacy-app";
import SiteHeader from "@/components/site-header";

import {canUseAgenda,doctorHome} from "@/lib/doctor-services";
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await getSession();
  if (!session?.account) redirect("/");
  if(!canUseAgenda(session))redirect(doctorHome(session));
  return <div className="rn-hub rn-agenda"><SiteHeader account={session.account} services={session.services} active="agenda"/><LegacyApp /></div>;
}

