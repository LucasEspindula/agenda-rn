import {PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib';

export type PdfColumn={label:string;width:number;align?:'left'|'right'};
const green=rgb(.07,.36,.39),muted=rgb(.34,.42,.47),line=rgb(.83,.87,.88);
export const brl=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
export const brDate=(value:string|null|undefined)=>{const hit=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return hit?hit[3]+'/'+hit[2]+'/'+hit[1]:'—'};
export const brDateTime=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value));

export class PdfReport{
 private doc!:PDFDocument;private font!:PDFFont;private bold!:PDFFont;private page!:PDFPage;
 y=0;readonly width=841.89;readonly height=595.28;readonly margin=34;
 async init():Promise<this>{this.doc=await PDFDocument.create();this.font=await this.doc.embedFont(StandardFonts.Helvetica);this.bold=await this.doc.embedFont(StandardFonts.HelveticaBold);this.addPage();return this}
 private addPage():void{this.page=this.doc.addPage([this.width,this.height]);this.y=this.height-this.margin}
 private ensure(height:number):void{if(this.y-height<this.margin)this.addPage()}
 text(value:string,x:number,y:number,size=8,bold=false,color=green):void{this.page.drawText(value||'—',{x,y,size,font:bold?this.bold:this.font,color})}
 line(y:number):void{this.page.drawLine({start:{x:this.margin,y},end:{x:this.width-this.margin,y},thickness:.5,color:line})}
 header(title:string,subtitle:string,details:string[]=[]):void{this.text('RN Integra · '+title,this.margin,this.y,17,true);this.y-=21;this.text(subtitle,this.margin,this.y,9,false,muted);for(const detail of details){this.y-=11;this.text(detail,this.margin,this.y,7,false,muted)}this.y-=14;this.line(this.y);this.y-=14}
 section(title:string,subtitle?:string):void{this.ensure(subtitle?43:28);this.text(title,this.margin,this.y,11,true);this.y-=13;if(subtitle){this.text(subtitle,this.margin,this.y,7,false,muted);this.y-=12}}
 private wrap(value:string,width:number,size=7):string[]{const words=String(value||'—').split(/\s+/),lines:string[]=[];let current='';for(const word of words){const next=current?current+' '+word:word;if(this.font.widthOfTextAtSize(next,size)<=width)current=next;else{if(current)lines.push(current);current=word}}if(current)lines.push(current);return lines.length?lines:['—']}
 table(columns:PdfColumn[],rows:readonly string[][]):void{const x=this.margin,total=columns.reduce((n,c)=>n+c.width,0),head=()=>{this.ensure(20);let left=x;this.page.drawRectangle({x,y:this.y-12,width:total,height:14,color:rgb(.94,.97,.97)});for(const col of columns){this.text(col.label.toUpperCase(),left+3,this.y-8,6,true,muted);left+=col.width}this.y-=16};head();for(const row of rows){const cells=row.map((value,index)=>this.wrap(value,columns[index].width-6)),height=Math.max(15,...cells.map(cell=>cell.length*9+6));if(this.y-height<this.margin+12){this.addPage();head()}let left=x;cells.forEach((cell,index)=>{cell.forEach((value,lineIndex)=>{const textWidth=this.font.widthOfTextAtSize(value,7),px=columns[index].align==='right'?left+columns[index].width-3-textWidth:left+3;this.text(value,px,this.y-9-lineIndex*9,7)});left+=columns[index].width});this.y-=height;this.line(this.y)}this.y-=12}
 async bytes():Promise<Uint8Array>{return this.doc.save()}
}
export async function pdfResponse(report:PdfReport,filename:string):Promise<Response>{const source=await report.bytes(),bytes=new Uint8Array(source.byteLength);bytes.set(source);return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="'+filename.replace(/[^a-z0-9._-]+/gi,'-')+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
