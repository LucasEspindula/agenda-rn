import {getSession} from "@/app/authz";
import {redirect} from "next/navigation";
import SiteHeader from "@/components/site-header";
import BillingSubnav from "../billing-subnav";
import DenialManager from "../denial-manager";
import "../billing.css";

export const dynamic="force-dynamic";
export default async function GlosasPage(){
 const session=await getSession();
 if(!session)redirect("/");
 if(!["general_manager","secretary"].includes(session.account.role))redirect("/dashboard");
 if(process.env.RN_DENIALS_ENABLED!=="true")
   redirect(session.account.role==="general_manager"?"/billing?view=insurance":"/dashboard");
 return <div className="rn-hub">
  <SiteHeader account={session.account} active={session.account.role==="secretary"?"denials":"billing"} services={session.services}/>
  {session.account.role==="general_manager"&&<BillingSubnav active="denials" denialsEnabled/>}
  <main className="billing-main"><DenialManager/></main>
 </div>;
}
