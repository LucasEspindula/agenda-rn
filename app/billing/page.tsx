import { getSession } from "@/app/authz"; import { redirect } from "next/navigation"; import BillingClient from "./billing-client";
import SiteHeader from "@/components/site-header";
import "./billing.css";
export const dynamic="force-dynamic";
export default async function BillingPage(){const s=await getSession();if(!s||s.account.role==="doctor") redirect("/dashboard");return <div className="rn-hub"><SiteHeader account={s.account} active="billing"/><BillingClient/></div>}