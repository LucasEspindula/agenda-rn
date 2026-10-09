export const PERSEUS_PARSER_VERSION='1.0.0';
export const PERSEUS_LIMITS={maxItems:2000,maxColumns:160,maxCellLength:10000,maxSheets:20,maxXmlDepth:32,maxXmlNodes:50000} as const;

export type PerseusFormat='CSV'|'XLSX'|'XML';
export type PerseusColumn={original:string;normalized:string};
export type PerseusSheet={name:string;rowCount:number;columns:PerseusColumn[]};
export type PerseusRawItem={sourceIndex:number;source?:{sheet?:string;row?:number;path?:string};rawData:Record<string,unknown>};
export type PerseusParseResult={
 format:PerseusFormat;
 parserKey:string;
 parserVersion:string;
 layoutFingerprint:string;
 structure:{rowCount:number;columnCount:number;sheetCount:number;sheets?:PerseusSheet[];columns?:PerseusColumn[]};
 items:PerseusRawItem[];
 warnings:string[];
};
export type PerseusInspection={kind:'parsed';result:PerseusParseResult}|{kind:'unsupported';format:string|null;message:string};

export class PerseusParseError extends Error {
 constructor(message:string){super(message);this.name='PerseusParseError';}
}
