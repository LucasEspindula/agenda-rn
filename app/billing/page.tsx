import { getSession } from "@/app/authz"; import { redirect } from "next/navigation"; import BillingClient from "./billing-client";
export const dynamic="force-dynamic";
export default async function BillingPage(){const s=await getSession();if(!s||s.account.role==="doctor") redirect("/dashboard");return <BillingClient/>}