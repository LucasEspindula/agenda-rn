'use client';
import {useCallback,useEffect,useState} from 'react';
import {Pencil,Trash2} from 'lucide-react';
import AppDialog from '@/components/app-dialog';
import {duplicateHospital,hospitalAbbreviation,hospitalIsInUse,normalizeHospitalAbbreviation,hospitalsFrom,withHospitals,type Hospital,type HospitalState} from '@/lib/hospital-directory';

export default function HospitalDirectory(){
 const [state,setState]=useState<HospitalState|null>(null),[revision,setRevision]=useState<string|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [dialogOpen,setDialogOpen]=useState(false),[draft,setDraft]=useState<Hospital|null>(null),[draftName,setDraftName]=useState(''),[draftAbbreviation,setDraftAbbreviation]=useState(''),[modalError,setModalError]=useState(''),[removing,setRemoving]=useState<Hospital|null>(null);

 const load=useCallback(async()=>{setLoading(true);try{
  const response=await fetch('/api/state',{cache:'no-store'}),payload=await response.json();
  if(!response.ok)throw Error(payload.error||'Não foi possível carregar hospitais.');
  setState(payload.state||null);setRevision(payload.revision||null);setError('');
 }catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível carregar hospitais.')}finally{setLoading(false)}},[]);
 useEffect(()=>{void load()},[load]);

 async function persist(next:HospitalState){
  const response=await fetch('/api/state',{method:'PUT',headers:{'content-type':'application/json','If-Match':revision||'new'},body:JSON.stringify(next)}),payload=await response.json();
  if(!response.ok){
   const errorMessage=payload.error||'Não foi possível salvar hospitais.';
   if(response.status===409)await load();
   throw Error(errorMessage);
  }
  await load();
 }
 function open(hospital?:Hospital){setDraft(hospital||null);setDraftName(hospital?.name||'');setDraftAbbreviation(hospital?hospitalAbbreviation(hospital):'');setModalError('');setDialogOpen(true)}
 async function save(event:React.FormEvent){event.preventDefault();if(!state||busy)return;const name=draftName.trim(),abbreviation=normalizeHospitalAbbreviation(draftAbbreviation);
  if(!name){setModalError('Informe o nome do hospital.');return}
  if(!abbreviation){setModalError('Informe a abreviação do hospital.');return}
  if(duplicateHospital(hospitalsFrom(state),name,draft?.id||'')){setModalError('Hospital já cadastrado.');return}
  setBusy(true);setModalError('');try{
   const hospital=draft?{...draft,name,abbreviation}:{id:crypto.randomUUID(),name,abbreviation};
   const hospitals=draft?hospitalsFrom(state).map(value=>value.id===hospital.id?hospital:value):[...hospitalsFrom(state),hospital];
   await persist(withHospitals(state,hospitals));setDialogOpen(false);setDraft(null);setMessage('Hospital salvo.');
  }catch(reason){setModalError(reason instanceof Error?reason.message:'Não foi possível salvar hospital.')}finally{setBusy(false)}
 }
 function askRemove(hospital:Hospital){if(!state)return;if(hospitalIsInUse(state,hospital.id)){setError('Hospital em uso. Este hospital está vinculado a agendamentos ou regras e não pode ser removido.');return}setRemoving(hospital);setModalError('')}
 async function remove(){if(!state||!removing||busy)return;setBusy(true);setModalError('');try{
  await persist(withHospitals(state,hospitalsFrom(state).filter(hospital=>hospital.id!==removing.id)));setRemoving(null);setMessage('Hospital removido.');
 }catch(reason){setModalError(reason instanceof Error?reason.message:'Não foi possível remover hospital.')}finally{setBusy(false)}
 }
 const hospitals=hospitalsFrom(state);
 return <main className="billing-main"><div className="billing-section-head page-description-head"><p className="page-description">Hospitais utilizados nos agendamentos e compartilhados entre as agendas.</p><button className="billing-primary" disabled={loading||busy} onClick={()=>open()}>+ Cadastrar hospital</button></div>
  {error&&<p className="billing-error" role="alert">{error}</p>}{message&&<p className="billing-message" role="status">{message}</p>}
  {loading?<p className="billing-empty">Carregando…</p>:<div className="billing-panel"><table className="billing-table billing-admin-table doctor-table hospital-table"><thead><tr><th>Abreviação</th><th>Hospital</th><th>Ações</th></tr></thead><tbody>{hospitals.map(hospital=><tr key={hospital.id}><td>{hospitalAbbreviation(hospital)}</td><td>{hospital.name}</td><td><div className="doctor-row-actions"><button className="billing-icon-action billing-edit" disabled={busy} title="Editar hospital" aria-label={'Editar hospital '+hospital.name} onClick={()=>open(hospital)}><Pencil size={16}/></button><button className="billing-icon-action billing-delete" disabled={busy} title="Remover hospital" aria-label={'Remover hospital '+hospital.name} onClick={()=>askRemove(hospital)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table>{!hospitals.length&&<p className="billing-empty">Nenhum hospital cadastrado.</p>}</div>}
  {dialogOpen&&<AppDialog label={draft?'Editar hospital':'Cadastrar hospital'} onClose={()=>setDialogOpen(false)} busy={busy}><h2>{draft?'Editar hospital':'Cadastrar hospital'}</h2><form onSubmit={save}><div className="billing-form-grid"><label>Nome<input autoFocus required value={draftName} onChange={event=>setDraftName(event.target.value)}/></label><label>Abreviação<input required maxLength={16} value={draftAbbreviation} onChange={event=>setDraftAbbreviation(normalizeHospitalAbbreviation(event.target.value))}/></label></div>{modalError&&<p className="billing-error" role="alert">{modalError}</p>}<div className="billing-modal-actions"><button type="button" className="billing-secondary" disabled={busy} onClick={()=>setDialogOpen(false)}>Cancelar</button><button className="billing-primary" disabled={busy}>{busy?'Salvando…':'Salvar'}</button></div></form></AppDialog>}
  {removing&&<AppDialog label="Remover hospital" onClose={()=>setRemoving(null)} busy={busy}><h2>Remover hospital?</h2><p>O hospital será removido das opções disponíveis.</p>{modalError&&<p className="billing-error" role="alert">{modalError}</p>}<div className="billing-modal-actions"><button className="billing-secondary" disabled={busy} onClick={()=>setRemoving(null)}>Cancelar</button><button className="billing-danger" disabled={busy} onClick={()=>void remove()}>{busy?'Removendo…':'Remover'}</button></div></AppDialog>}
 </main>;
}
