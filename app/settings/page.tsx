import {getSession} from '@/app/authz';
import {redirect} from 'next/navigation';
import {doctorHome} from '@/lib/doctor-services';
import SiteHeader from '@/components/site-header';
import {LegacyApp} from '@/app/dashboard/legacy-app';
import InviteForm from '@/components/invite-form';
export const dynamic='force-dynamic';
export default async function SettingsPage(){
 const session=await getSession();
 if(!session)redirect('/');
 if(session.account.role!=='general_manager')redirect(doctorHome(session));
 return <div className="rn-hub rn-agenda settings-module"><SiteHeader account={session.account} services={session.services} active="settings"/><p className="invite-panel settings-org-hint">Equipe, convites por e-mail e organizações ficam em <a href="/organizacao">Organização</a>.</p><LegacyApp initialView="settings"/></div>;
}

