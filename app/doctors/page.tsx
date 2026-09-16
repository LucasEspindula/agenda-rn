import {getSession} from '@/app/authz';
import {redirect} from 'next/navigation';
import SiteHeader from '@/components/site-header';
import DoctorDirectory from './doctor-directory';
import '@/app/billing/billing.css';
export const dynamic='force-dynamic';
export default async function DoctorsPage(){const session=await getSession();if(!session||session.account.role!=='general_manager')redirect('/dashboard');return <div className="rn-hub"><SiteHeader account={session.account}/><DoctorDirectory/></div>}
