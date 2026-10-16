import {getSession} from "@/app/authz";
import {redirect} from "next/navigation";
import SiteHeader from "@/components/site-header";
import BillingSubnav from "../billing-subnav";
import MonthlyClosing from "../monthly-closing";
import "../billing.css";

export const dynamic="force-dynamic";
export default async function MonthlyClosingPage(){
 const session=await getSession();
 if(!session)redirect("/");
 if(session.account.role!=="general_manager")redirect("/dashboard");
 if(process.env.RN_MONTHLY_CLOSING_ENABLED!=="true")redirect("/billing");
 return <div className="rn-hub">
  <SiteHeader account={session.account} active="billing" services={session.services}/>
  <BillingSubnav active="closing" denialsEnabled={process.env.RN_DENIALS_ENABLED==="true"} closingEnabled/>
  <main className="billing-main"><MonthlyClosing/></main>
 </div>;
}
