import {getSession} from "@/app/authz";import {redirect} from "next/navigation";import BillingClient from "./billing-client";
import DoctorBilling from "./doctor-billing";
import {canOpenBilling,doctorHome} from "@/lib/doctor-services";
import SiteHeader from "@/components/site-header";
import "./billing.css";
export const dynamic="force-dynamic";
export default async function BillingPage(){const s=await getSession();if(!s)redirect('/');if(!canOpenBilling(s))redirect(doctorHome(s));return <div className="rn-hub"><SiteHeader account={s.account} active="billing" services={s.services}/>{s.account.role==='doctor'?<DoctorBilling invoiceOnly={!s.services.billing_enabled}/>:<BillingClient/>}</div>}
