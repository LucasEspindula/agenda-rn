export type PortalDeadlineRule={id?:string;professional_id:string|null;destination_key:string;submission_channel_code:string;deadline_days:number;alert_before_days:number;starts_from:"SERVICE_DATE"|"GUIDE_RECEIVED";valid_from:string;valid_to:string|null;active?:boolean};
export type DeadlineState="SUBMITTED"|"NO_RULE"|"WAITING_GUIDE"|"NO_DATE"|"OVERDUE"|"ALERT"|"ON_TIME";
export function validCivilDate(date:unknown):boolean;
export function addCalendarDays(date:string,days:number):string|null;
export function destinationKey(value:unknown):string;
export function matchDeadlineRule(rules:PortalDeadlineRule[],scope:{serviceDate:string;destination:string;professionalId:string;channel:string}):PortalDeadlineRule|null;
export function calculatePortalDeadline(args:{today:string;serviceDate:string;guideReceivedAt:string|null;submittedAt:string|null;rule:PortalDeadlineRule|null}):{state:DeadlineState;deadline:string|null;remaining:number|null};
