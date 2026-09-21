import {getSession} from '@/app/authz';
import {doctorHome} from '@/lib/doctor-services';
import {redirect} from 'next/navigation';
import HubLogout from '@/app/hub/hub-logout';
export default async function NoServices(){const session=await getSession();if(!session)redirect('/');if(doctorHome(session)!=='/no-services')redirect(doctorHome(session));return <main className="min-h-screen grid place-items-center bg-slate-50"><section className="rounded-2xl bg-white p-8 shadow"><h1>RN Integra</h1><p>Nenhum serviço está habilitado para seu cadastro. Entre em contato com a gerência.</p><HubLogout/></section></main>}
