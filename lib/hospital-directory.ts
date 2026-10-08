export type Hospital={id:string;name:string;abbreviation?:string};
export type HospitalState={hospitals?:Hospital[];appointments?:Array<{hospitalId?:string}>;cancelledAppointments?:Array<{hospitalId?:string}>;schedulingRules?:Array<{hospitalId?:string}>;[key:string]:unknown};

export function automaticHospitalAbbreviation(name=''){
 if(String(name).trim().toLowerCase()==='hospital blanc')return 'Blanc';
 const words=String(name).trim().split(/\s+/).filter(word=>word&&!/^(de|da|do|das|dos)$/i.test(word));
 if(!words.length)return 'H';
 if(words.length===1)return words[0].slice(0,4).toUpperCase();
 return words.map(word=>word[0]).join('').slice(0,4);
}

export const hospitalAbbreviation=(hospital:Hospital)=>{
 const abbreviation=String(hospital.abbreviation||'').trim();
 return abbreviation||automaticHospitalAbbreviation(hospital.name);
};

export const hospitalsFrom=(state:HospitalState|null)=>state?.hospitals||[];

export function duplicateHospital(hospitals:Hospital[],name:string,exceptId=''){
 return hospitals.some(hospital=>hospital.id!==exceptId&&hospital.name.localeCompare(name,'pt-BR',{sensitivity:'base'})===0);
}

export function hospitalIsInUse(state:HospitalState,hospitalId:string){
 return [state.appointments||[],state.cancelledAppointments||[],state.schedulingRules||[]]
  .some(items=>items.some(item=>item.hospitalId===hospitalId));
}

export const withHospitals=(state:HospitalState,hospitals:Hospital[]):HospitalState=>({...state,hospitals});
