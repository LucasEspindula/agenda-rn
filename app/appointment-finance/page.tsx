import { getSession } from '@/app/authz';
import { redirect } from 'next/navigation';
import BillingClient from '@/app/billing/billing-client';
import '@/app/hub/hub.css';
import '@/app/billing/billing.css';
export const dynamic='force-dynamic';
export default async function AppointmentFinance({searchParams}:{searchParams:Promise<{id?:string}>}) {
 const s=await getSession();
 if(!s||s.account.role==='doctor')redirect('/');
 const {id}=await searchParams;
 if(!id)return <p>Selecione um atendimento.</p>;
 return <div className="rn-hub"><BillingClient appointmentId={id}/></div>;
}
