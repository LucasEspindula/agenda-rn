import { getSession } from "@/app/authz";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/site-header";
import PerseusClient from "./perseus-client";
import { isPerseusOperationalEnabled } from "@/lib/perseu/availability";
import "@/app/billing/billing.css";

export const dynamic = "force-dynamic";

export default async function PerseusPage() {
  if (!isPerseusOperationalEnabled()) redirect("/billing?view=insurance");
  const session = await getSession();
  if (!session) redirect("/");
  if (session.account.role !== "general_manager") redirect("/hub");
  return (
    <div className="rn-hub">
      <SiteHeader
        account={session.account}
        active="billing"
        services={session.services}
      />
      <PerseusClient />
    </div>
  );
}
