import {getSession} from "@/app/authz";
import {redirect} from "next/navigation";
import SiteHeader from "@/components/site-header";
import PortalSubmissions from "@/app/billing/portal-submissions";
import "@/app/billing/billing.css";
export const dynamic="force-dynamic";
export default async function PortalGuidesPage(){
 const session=await getSession();
 if(!session)redirect("/");
 if(!["general_manager","secretary"].includes(session.account.role))redirect("/dashboard");
 if(process.env.RN_PORTAL_SUBMISSIONS_ENABLED!=="true")redirect(session.account.role==="general_manager"?"/billing?view=insurance":"/dashboard");
 return <div className="rn-hub">
   <SiteHeader account={session.account} services={session.services} active="billing"/>
   <main className="billing-main">
     <PortalSubmissions/>
   </main>
 </div>;
}
