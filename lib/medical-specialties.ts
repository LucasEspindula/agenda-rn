import specialties from './medical-specialties.json';
export const MEDICAL_SPECIALTIES:readonly string[]=specialties;
export function isAnesthesiologist(doctor:{specialty?:string}|null|undefined){return doctor?.specialty?.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()==='anestesiologia';}
export function canonicalSpecialty(value:string){return MEDICAL_SPECIALTIES.find(s=>s.toLocaleLowerCase('pt-BR')===value.trim().toLocaleLowerCase('pt-BR'));}
