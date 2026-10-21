import {getSession} from "@/app/authz";
import {redirect} from "next/navigation";
import SiteHeader from "@/components/site-header";
import BillingSubnav from "../../../billing-subnav";
import EntityAnalytics from "../../../entity-analytics";
import "../../../billing.css";
import "../../../entity-analytics.css";
export const dynamic="force-dynamic";

export default async function EntityFinancialAnalyticsPage({params}:{
 params:Promise<{entityId:string}>
}){
 const session=await getSession();
 if(!session)redirect("/");
 if(session.account.role!=="general_manager")redirect("/billing");
 const {entityId}=await params;
 return <div className="rn-hub">
  <SiteHeader account={session.account} active="billing" services={session.services}/>
  <BillingSubnav active="entities"
   denialsEnabled={process.env.RN_DENIALS_ENABLED==="true"}
   closingEnabled={process.env.RN_MONTHLY_CLOSING_ENABLED==="true"}/>
  <main className="billing-main"><EntityAnalytics entityId={entityId}/></main>
 </div>;
}
