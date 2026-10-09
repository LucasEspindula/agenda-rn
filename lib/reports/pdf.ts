// @ts-nocheck
import {PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib';

export type PdfColumn={label:string;width:number;align?:'left'|'right'};
const green=rgb(.07,.36,.39), muted=rgb(.34,.42,.47), line=rgb(.83,.87,.88);
export const brl=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
export const brDate=(value:string|null|undefined)=>{const hit=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return hit?hit[3]+'/'+hit[2]+'/'+hit[1]:'—'};
export class PdfReport {
 doc!:PDFDocument; font!:PDFFont; bold!:PDFFont; page!:PDFPage; y=0; readonly width=841.89; readonly height=595.28; readonly margin=34;
 async init(){this.doc=await PDFDocument.create();this.font=await this.doc.embedFont(StandardFonts.Helvetica);this.bold=await this.doc.embedFont(StandardFonts.HelveticaBold);this.addPage();return this}
 addPage(){this.page=this.doc.addPage([this.width,this.height]);this.y=this.height-this.margin}
 text(value:string,x:number,y:number,size=8,bold=false,color=green){this.page.drawText(String(value||'—'),{x,y,size,font:bold?this.bold:this.font,color})}
 line(y:number){this.page.drawLine({start:{x:this.margin,y},end:{x:this.width-this.margin,y},thickness:.5,color:line})}
 header(title:string,subtitle:string){this.text('RN Integra · '+title,this.margin,this.y,17,true);this.y-=22;this.text(subtitle,this.margin,this.y,8,false,muted);this.y-=16;this.line(this.y);this.y-=14}
 wrap(value:string,width:number,size=7){const words=String(value||'—').split(/\s+/),lines:string[]=[];let line='';
 for(const word of words){const next=line?line+' '+word:word;if(this.font.widthOfTextAtSize(next,size)<=width)line=next;else{if(line)lines.push(line);line=word}}if(line)lines.push(line);return lines.length?lines:['—']}
 table(columns:PdfColumn[],rows:string[][]){const x=this.margin,total=columns.reduce((n,c)=>n+c.width,0),drawHead=()=>{let left=x;this.page.drawRectangle({x,y:this.y-12,width:total,height:14,color:rgb(.94,.97,.97)});for(const c of columns){this.text(c.label.toUpperCase(),left+3,this.y-8,6,true,muted);left+=c.width}this.y-=16};
 drawHead();for(const row of rows){const cells=row.map((v,i)=>this.wrap(v,columns[i].width-6)),height=Math.max(15,...cells.map(c=>c.length*9+6));if(this.y-height<this.margin+12){this.addPage();drawHead()}let left=x;cells.forEach((lines,i)=>{lines.forEach((v,j)=>{const w=this.font.widthOfTextAtSize(v,7),px=columns[i].align==='right'?left+columns[i].width-3-w:left+3;this.text(v,px,this.y-9-j*9,7,false,green)});left+=columns[i].width});this.y-=height;this.line(this.y)}
 this.y-=12}
 async bytes(){return this.doc.save()}
}
export async function pdfResponse(report:PdfReport,filename:string){const bytes=await report.bytes(),body=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;return new Response(body,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="'+filename.replace(/[^a-z0-9._-]+/gi,'-')+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
