import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Área de organização: lobby, gestão da organização/equipe, primeiros passos e links legais.
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').split('\r\n').join('\n');
const sql=read('supabase/migrations/20261111120000_organization_area.sql');
const fn=name=>sql.slice(sql.indexOf(`create or replace function public.${name}(`),sql.indexOf('end;$$;',sql.indexOf(`create or replace function public.${name}(`)));

test('database functions are manager-only, scoped to the active organization and server-only',()=>{
 for(const name of ['organization_team','cancel_invite','update_organization','organization_setup_status'])
  assert.match(fn(name),/require_organization_manager\(p_actor,p_org\)/,name);
 assert.match(fn('organization_team'),/where m\.organization_id=p_org and m\.active/);
 assert.match(fn('organization_team'),/t\.organization_id=p_org and t\.used_at is null and t\.expires_at>now\(\)/);
 assert.doesNotMatch(fn('organization_team'),/token_hash|password/,'never exposes secrets');
 assert.match(fn('cancel_invite'),/id=p_invite and kind='invite' and organization_id=p_org and used_at is null/);
 assert.match(fn('deactivate_user_access'),/O titular da conta não pode ser removido/);
 assert.match(sql,/from public,anon,authenticated;\ngrant execute on function public\.organization_team\(bigint,uuid\),public\.cancel_invite/);
});

test('login sends people with several organizations to the lobby; multi-membership no longer breaks login',()=>{
 const authz=read('app/authz.ts'),login=read('app/api/auth/login/route.ts');
 assert.match(authz,/activeMembershipCount[\s\S]*\.limit\(2\)/);
 assert.doesNotMatch(authz.slice(authz.indexOf('activeMembershipCount')),/maybeSingle\(\)[\s\S]*export async function hasActiveMembership/);
 assert.match(login,/next: organizations > 1 \? "\/organizacoes" : "\/"/);
 const lobby=read('app/organizacoes/page.tsx');
 assert.match(lobby,/if \(!session\) redirect\("\/"\)/);
 assert.match(lobby,/session\.organizations\.length < 2\) redirect\(doctorHome\(session\)\)/);
 assert.match(read('components/organization-picker.tsx'),/action: "switch", organizationId: id/);
});

test('organization page and APIs are restricted to managers',()=>{
 const page=read('app/organizacao/page.tsx');
 assert.match(page,/role !== "general_manager"\) redirect\(doctorHome\(session\)\)/);
 const team=read('app/api/organizations/team/route.ts'),orgs=read('app/api/organizations/route.ts'),invites=read('app/api/invites/route.ts');
 assert.match(team,/!isManager\(session\.account\.role\)\) return Response\.json\(\{ error: "Acesso restrito à gerência" \}, \{ status: 403 \}\)/);
 assert.match(orgs,/!isManager\(session\.account\.role\)\) throw new HttpError\(403/);
 assert.match(orgs,/export const PATCH = secureMutation\(handlePATCH\)/);
 assert.match(invites,/z\.string\(\)\.uuid\(\)\.safeParse\(id\)/);
 assert.match(invites,/export const DELETE = secureMutation\(cancel\)/);
 const area=read('components/organization-area.tsx');
 assert.match(area,/!m\.isYou && !m\.isOwner &&/,'cannot remove yourself or the account owner from the UI');
 assert.match(area,/window\.confirm\(/);
});

test('navigation, mobile menu, first steps and legal links',()=>{
 assert.match(read('components/site-header.tsx'),/general_manager'&&<a className="hub-icon hub-settings" href="\/organizacao"[^>]*aria-label="Configurações"/);
 assert.match(read('components/mobile-navigation.tsx'),/role === "general_manager" && <a href="\/organizacao"[\s\S]*?<span>Configurações<\/span>/);
 const mobile=read('components/mobile-navigation.tsx');
 assert.match(mobile,/<OrganizationSwitcher \/>/);
 assert.match(mobile,/href="\/termos"[\s\S]*href="\/privacidade"/);
 assert.match(read('app/page.tsx'),/href="\/termos"[\s\S]*href="\/privacidade"/);
 assert.match(read('components/organization-area.tsx'),/href="\/termos"[\s\S]*href="\/privacidade"/);
 const dash=read('app/dashboard/page.tsx'),steps=read('components/setup-steps.tsx');
 assert.match(dash,/role === "general_manager" && <SetupSteps/);
 assert.match(steps,/\/api\/organizations\/team\?setup=1/);
 assert.match(steps,/if \(steps\.every\(s => s\.done\)\) return null/);
 assert.match(steps,/try \{ window\.localStorage\.setItem/);
});

test('Cadastros and the old Configurações are folded into the new Configurações tabs',()=>{
 assert.match(read('app/doctors/page.tsx'),/redirect\("\/organizacao\?aba=medicos"\)/);
 assert.match(read('app/doctors/page.tsx'),/\/organizacao\/agenda\?doctor_id=/);
 assert.match(read('app/settings/page.tsx'),/redirect\("\/organizacao\?aba=equipe"\)/);
 assert.doesNotMatch(read('lib/navigation.ts'),/'\/doctors'/);
 assert.doesNotMatch(read('components/site-header.tsx'),/href="\/settings"/);
 assert.doesNotMatch(read('components/mobile-navigation.tsx'),/href="\/settings"/);
 assert.doesNotMatch(read('public/legacy-app.js'),/'\/settings'|"\/doctors/);
 const area=read('components/organization-area.tsx');
 assert.match(area,/\["medicos", "Médicos"\], \["equipe", "Equipe"\], \["dados", "Organização"\]/);
 assert.match(area,/send\("\/api\/access", "POST", \{ id: user\.id, email: user\.email, name: user\.name \|\| "", role: user\.role, updated_at: user\.updated_at, agendaIds: selected \}\)/);
 const agenda=read('app/organizacao/agenda/page.tsx');
 assert.match(agenda,/role !== "general_manager"\) redirect\(doctorHome\(session\)\)/);
 assert.match(agenda,/<LegacyApp initialView="settings" adminSection="rules" doctorId=\{doctor_id\} \/>/);
});

test('doctors tab has no billing dependency and gives access only by invite',()=>{
 const doctors=read('components/organization-doctors.tsx');
 assert.doesNotMatch(doctors,/api\/billing|doctor-entities|password/i);
 assert.match(doctors,/send\("\/api\/invites", "POST", \{ email, role: "doctor", name: doctor\.name, doctorId: doctor\.id \}\)/);
 assert.match(doctors,/send\("\/api\/doctors", "POST", \{ kind: "doctor", data: draft/);
});

test('hospital is free text in the appointment form, reusing names before creating one',()=>{
 const body=read('app/dashboard/legacy-body.ts'),js=read('public/legacy-app.js');
 assert.match(body,/<input id="appointmentHospital" list="hospitalOptions" required/);
 assert.match(js,/function resolveHospitalText\(text\)/);
 assert.match(js,/sensitivity:"base"/);
 assert.match(js,/<input id="detailHospital" list="hospitalOptions"/);
 assert.match(js,/commitHospital\(hospitalChoice\);const i=state\.appointments\.findIndex/);
 assert.match(js,/Para um hospital novo, peça à secretaria\./,'doctors cannot create hospitals through suggestions');
});
