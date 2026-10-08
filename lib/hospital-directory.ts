export type Hospital={id:string;name:string};
export type HospitalState={hospitals?:Hospital[];appointments?:Array<{hospitalId?:string}>;cancelledAppointments?:Array<{hospitalId?:string}>;schedulingRules?:Array<{hospitalId?:string}>;[key:string]:unknown};

export const hospitalsFrom=(state:HospitalState|null)=>state?.hospitals||[];

export function duplicateHospital(hospitals:Hospital[],name:string,exceptId=''){
 return hospitals.some(hospital=>hospital.id!==exceptId&&hospital.name.localeCompare(name,'pt-BR',{sensitivity:'base'})===0);
}

export function hospitalIsInUse(state:HospitalState,hospitalId:string){
 return [state.appointments||[],state.cancelledAppointments||[],state.schedulingRules||[]]
  .some(items=>items.some(item=>item.hospitalId===hospitalId));
}

export const withHospitals=(state:HospitalState,hospitals:Hospital[]):HospitalState=>({...state,hospitals});
