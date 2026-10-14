export const PERSEUS_PARSER_VERSION='1.1.0';
export const PERSEUS_LIMITS={maxItems:2000,maxRows:10000,maxColumns:160,maxCellLength:10000,maxSheets:20,maxXmlDepth:32,maxXmlNodes:50000} as const;

export type PerseusFormat='CSV'|'XLSX'|'XML';
export type PerseusColumn={original:string;key:string;normalized:string};
export type PerseusTableColumn=PerseusColumn&{position?:number};
export type PerseusRegion={rowStart?:number;rowEnd?:number;columnStart?:number;columnEnd?:number;path?:string};
export type PerseusDetectionEvidence={classification:'clear'|'probable'|'ambiguous';signals:string[]};
export type PerseusTable={tableId:string;source:{sheet?:string;path?:string};region?:PerseusRegion;headerLocation?:{row?:number;column?:number;path?:string};columns:PerseusTableColumn[];recordCount:number;detectionEvidence:PerseusDetectionEvidence;warnings:string[]};
export type PerseusSheet={name:string;rowCount:number;columns:PerseusColumn[];tables?:PerseusTable[]};
export type PerseusRawItem={sourceIndex:number;source?:{sheet?:string;row?:number;path?:string;tableId?:string;region?:PerseusRegion};rawData:Record<string,unknown>};
export type PerseusParseResult={
 format:PerseusFormat;
 parserKey:string;
 parserVersion:string;
 layoutFingerprint:string;
 structure:{rowCount:number;columnCount:number;sheetCount:number;sheets?:PerseusSheet[];columns?:PerseusColumn[];tables?:PerseusTable[];fingerprintVersion?:number};
 items:PerseusRawItem[];
 warnings:string[];
};
export type PerseusInspection={kind:'parsed';result:PerseusParseResult}|{kind:'unsupported';format:string|null;message:string};

export class PerseusParseError extends Error {
 constructor(message:string){super(message);this.name='PerseusParseError';}
}
