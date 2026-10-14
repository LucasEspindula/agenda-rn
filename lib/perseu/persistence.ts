import type {PerseusParseResult,PerseusRawItem,PerseusRegion} from './contracts';

export type PerseusItemInsert={source_index:number;raw_data:Record<string,unknown>;source_metadata:{sheet?:string;row?:number;path?:string;table_id?:string;region?:PerseusRegion}};

function sourceMetadata(source:PerseusRawItem['source']):PerseusItemInsert['source_metadata']{
 const metadata:PerseusItemInsert['source_metadata']={};
 if(typeof source?.sheet==='string')metadata.sheet=source.sheet;
 if(typeof source?.row==='number')metadata.row=source.row;
 if(typeof source?.path==='string')metadata.path=source.path;
 if(typeof source?.tableId==='string')metadata.table_id=source.tableId;
 if(source?.region&&typeof source.region==='object')metadata.region=source.region;
 return metadata;
}

export function perseusItemRows(result:PerseusParseResult):PerseusItemInsert[]{
 return result.items.map(item=>({source_index:item.sourceIndex,raw_data:item.rawData,source_metadata:sourceMetadata(item.source)}));
}
