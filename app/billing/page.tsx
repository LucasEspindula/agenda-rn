import {getSession} from "@/app/authz";import {redirect} from "next/navigation";import BillingClient from "./billing-client";
import DoctorBilling from "./doctor-billing";
import {canOpenBilling,canOpenInvoices,doctorHome} from "@/lib/doctor-services";
import SiteHeader from "@/components/site-header";
import "./billing.css";
export const dynamic="force-dynamic";
export default async function BillingPage({searchParams}:{searchParams:Promise<{view?:string}>}){const params=await searchParams;const s=await getSession();if(!s)redirect('/');if(!(params.view==='invoices'?canOpenInvoices(s):canOpenBilling(s)))redirect(doctorHome(s));return <div className="rn-hub"><SiteHeader account={s.account} active="billing" services={s.services}/>{s.account.role==='doctor'?<DoctorBilling invoiceOnly={params.view==='invoices'||!s.services.billing_enabled}/>:<BillingClient initialView={params.view}/>}</div>}
