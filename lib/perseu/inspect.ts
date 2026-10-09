import type {PerseusInspection} from './contracts';
import {parseCsv} from './parsers/csv';
import {parseXlsx} from './parsers/xlsx';
import {parseXml} from './parsers/xml';

export function inspectPerseusDocument(format:string|null,bytes:Uint8Array):PerseusInspection{
 if(format==='CSV')return {kind:'parsed',result:parseCsv(bytes)};
 if(format==='XLSX')return {kind:'parsed',result:parseXlsx(bytes)};
 if(format==='XML')return {kind:'parsed',result:parseXml(bytes)};
 return {kind:'unsupported',format,message:'O Perseu ainda não possui parser para este formato.'};
}
