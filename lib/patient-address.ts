/** Optional patient address fields stay compatible with existing free-text records. */
export type PatientAddressInput={
 address?:string|null;
 addressNumber?:string|null;
 addressComplement?:string|null;
 addressNeighborhood?:string|null;
 addressCity?:string|null;
 addressState?:string|null;
 addressZip?:string|null;
};
export function formatPatientAddress(patient:PatientAddressInput):string{
 const street=(patient.address||'').trim();
 if(!street)return '';
 const number=(patient.addressNumber||'').trim();
 const complement=(patient.addressComplement||'').trim();
 const neighborhood=(patient.addressNeighborhood||'').trim();
 const city=(patient.addressCity||'').trim();
 const state=(patient.addressState||'').trim().toUpperCase();
 const zip=(patient.addressZip||'').trim();
 const first=[street,number?'nº '+number:'',complement].filter(Boolean).join(', ');
 const locality=[city,state].filter(Boolean).join('/');
 return [first,neighborhood,locality,zip?'CEP '+zip:''].filter(Boolean).join(' · ');
}
