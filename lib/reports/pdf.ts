import {PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib';

export type PdfColumn={label:string;width:number;align?:'left'|'right'};
export type PdfSectionOptions={reserve?:number};
const green=rgb(.07,.36,.39),muted=rgb(.34,.42,.47),line=rgb(.83,.87,.88);
export const brl=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
export const brDate=(value:string|null|undefined)=>{const hit=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return hit?hit[3]+'/'+hit[2]+'/'+hit[1]:'—'};
export const brDateTime=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value));
export const pdfColumnsWidth=(columns:readonly PdfColumn[])=>columns.reduce((total,column)=>total+column.width,0);

export class PdfReport{
 private doc!:PDFDocument;private font!:PDFFont;private bold!:PDFFont;private page!:PDFPage;
 y=0;readonly width=841.89;readonly height=595.28;readonly margin=34;
 get contentWidth():number{return this.width-this.margin*2}
 async init():Promise<this>{this.doc=await PDFDocument.create();this.font=await this.doc.embedFont(StandardFonts.Helvetica);this.bold=await this.doc.embedFont(StandardFonts.HelveticaBold);this.addPage();return this}
 private addPage():void{this.page=this.doc.addPage([this.width,this.height]);this.y=this.height-this.margin}
 private ensure(height:number):void{if(this.y-height<this.margin)this.addPage()}
 ensureSpace(height:number):void{this.ensure(height)}
 text(value:string,x:number,y:number,size=8,bold=false,color=green):void{this.page.drawText(value||'—',{x,y,size,font:bold?this.bold:this.font,color})}
 line(y:number):void{this.page.drawLine({start:{x:this.margin,y},end:{x:this.width-this.margin,y},thickness:.5,color:line})}
 header(title:string,subtitle:string,details:string[]=[],rightDetails:string[]=[],centerTitle?:string):void{
  this.text(centerTitle?'RN Integra':'RN Integra · '+title,this.margin,this.y,17,true);
  if(centerTitle){
   const size=13,labelWidth=this.bold.widthOfTextAtSize(centerTitle,size);
   this.text(centerTitle,(this.width-labelWidth)/2,this.y-1,size,true);
  }
  for(const [index,detail] of rightDetails.slice(0,2).entries()){
   const size=7,maxWidth=this.contentWidth*.45;
   let label=detail;
   while(label.length>3&&this.font.widthOfTextAtSize(label,size)>maxWidth)label=label.slice(0,-4)+'…';
   const labelWidth=this.font.widthOfTextAtSize(label,size);
   this.text(label,this.width-this.margin-labelWidth,this.y-index*11,size,false,muted);
  }
  this.y-=21;
  this.text(subtitle,this.margin,this.y,9,false,muted);
  for(const detail of details){this.y-=11;this.text(detail,this.margin,this.y,7,false,muted)}
  this.y-=14;this.line(this.y);this.y-=14;
 }
 section(title:string,subtitle?:string,options:PdfSectionOptions={}):void{this.ensureSpace((subtitle?43:28)+(options.reserve||0));this.text(title,this.margin,this.y,11,true);this.y-=13;if(subtitle){this.text(subtitle,this.margin,this.y,7,false,muted);this.y-=12}}
 dayHeading(value:string):void{
  this.ensureSpace(96);
  const top=this.y,height=20;
  this.page.drawRectangle({x:this.margin,y:top-height,width:this.contentWidth,height,color:rgb(.93,.96,.96)});
  this.text(value,this.margin+8,top-13,10,true);
  this.y=top-height-5;
 }
 private wrap(value:string,width:number,size=7):string[]{const words=String(value||'—').split(/\s+/),lines:string[]=[];let current='';for(const word of words){const next=current?current+' '+word:word;if(this.font.widthOfTextAtSize(next,size)<=width)current=next;else{if(current)lines.push(current);current=word}}if(current)lines.push(current);return lines.length?lines:['—']}
 table(columns:PdfColumn[],rows:readonly string[][]):void{const x=this.margin,total=pdfColumnsWidth(columns);if(total>this.contentWidth)throw new RangeError('A largura da tabela excede a área útil do PDF.');const head=()=>{this.ensureSpace(20);let left=x;this.page.drawRectangle({x,y:this.y-12,width:total,height:14,color:rgb(.94,.97,.97)});for(const col of columns){this.text(col.label.toUpperCase(),left+3,this.y-8,6,true,muted);left+=col.width}this.y-=16};head();for(const row of rows){const cells=row.map((value,index)=>this.wrap(value,columns[index].width-6)),height=Math.max(15,...cells.map(cell=>cell.length*9+6));if(this.y-height<this.margin+12){this.addPage();head()}let left=x;cells.forEach((cell,index)=>{cell.forEach((value,lineIndex)=>{const textWidth=this.font.widthOfTextAtSize(value,7),px=columns[index].align==='right'?left+columns[index].width-3-textWidth:left+3;this.text(value,px,this.y-9-lineIndex*9,7)});left+=columns[index].width});this.y-=height;this.line(this.y)}this.y-=12}
 // Grid de largura integral para relatórios financeiros. Mantém os relatórios legados intactos.
 gridTable(columns:PdfColumn[],rows:readonly string[][],rowTints:readonly ("replaced"|"cancelled"|null)[]=[]):void{
  if(!columns.length)return;
  const sum=pdfColumnsWidth(columns);
  if(!Number.isFinite(sum)||sum<=0||columns.some(c=>c.width<=0))
   throw new RangeError('Larguras das colunas inválidas.');
  const factor=this.contentWidth/sum;
  const widths=columns.map(c=>c.width*factor);
  const tableLeft=this.margin;
  const padding=7;
  const bodySize=7;
  const headerSize=6;
  const gridColor=rgb(.89,.92,.93);
  const headerBackground=rgb(.94,.97,.97);
  const drawRules=(yTop:number,yBottom:number)=>{
   this.page.drawLine({start:{x:tableLeft,y:yTop},end:{x:tableLeft+this.contentWidth,y:yTop},thickness:.5,color:gridColor});
   this.page.drawLine({start:{x:tableLeft,y:yBottom},end:{x:tableLeft+this.contentWidth,y:yBottom},thickness:.5,color:gridColor});
   let x=tableLeft;
   this.page.drawLine({start:{x,y:yTop},end:{x,y:yBottom},thickness:.35,color:gridColor});
   for(const width of widths){
    x+=width;
    this.page.drawLine({start:{x,y:yTop},end:{x,y:yBottom},thickness:.35,color:gridColor});
   }
  };
  const wrapGrid=(value:string,width:number,fontSize:number,bold:boolean):string[]=>{
   const face=bold?this.bold:this.font;
   const words=(value.trim()||'—').split(/\s+/);
   const lines:string[]=[];
   let current='';
   for(const word of words){
    const combined=current?current+' '+word:word;
    if(face.widthOfTextAtSize(combined,fontSize)<=width){current=combined;continue}
    if(current){lines.push(current);current=''}
    let chunk='';
    for(const letter of word){
     if(chunk&&face.widthOfTextAtSize(chunk+letter,fontSize)>width){
      lines.push(chunk);chunk=letter;
     }else{chunk+=letter}
    }
    current=chunk;
   }
   if(current)lines.push(current);
   return lines.length?lines:['—'];
  };
  const layout=(values:readonly string[],fontSize:number,bold:boolean)=>{
   return columns.map((col,index)=>wrapGrid(String(values[index]??'—'),
    widths[index]-2*padding,fontSize,bold));
  };
  const rowHeight=(cells:string[][],fontSize:number)=>Math.max(22,...cells.map(lines=>lines.length*(fontSize+3)+11));
  const paint=(cells:string[][],fontSize:number,bold:boolean,yTop:number)=>{
   let x=tableLeft;
   for(let index=0;index<cells.length;index++){
    const cellWidth=widths[index];
    for(let rowIndex=0;rowIndex<cells[index].length;rowIndex++){
     const value=cells[index][rowIndex];
     const face=bold?this.bold:this.font;
     const length=face.widthOfTextAtSize(value,fontSize);
     const align=columns[index].align;
     const px=align==='right'?x+cellWidth-padding-length:x+padding;
     this.text(value,px,yTop-12-rowIndex*(fontSize+3),fontSize,bold,bold?muted:green);
    }
    x+=cellWidth;
   }
  };
  const headerCells=layout(columns.map(c=>c.label.toUpperCase()),headerSize,true);
  const headerHeight=rowHeight(headerCells,headerSize);
  const drawHeader=()=>{
   this.ensureSpace(headerHeight+22);
   const top=this.y;
   this.page.drawRectangle({x:tableLeft,y:top-headerHeight,width:this.contentWidth,height:headerHeight,color:headerBackground});
   paint(headerCells,headerSize,true,top);
   drawRules(top,top-headerHeight);
   this.y=top-headerHeight;
  };
  drawHeader();
  for(const [rowIndex,values] of rows.entries()){
   const cells=layout(values,bodySize,false);
   const height=rowHeight(cells,bodySize);
   if(this.y-height<this.margin+6){
    this.addPage();
    drawHeader();
   }
   const top=this.y;
   const tint=rowTints[rowIndex];
   if(tint){
    const fill=tint==="replaced"?rgb(.997,.983,.950):rgb(.997,.968,.968);
    this.page.drawRectangle({x:tableLeft,y:top-height,width:this.contentWidth,
      height,color:fill});
   }
   paint(cells,bodySize,false,top);
   drawRules(top,top-height);
   this.y=top-height;
  }
  this.y-=15;
 }
 async bytes():Promise<Uint8Array>{return this.doc.save()}
}
export async function pdfResponse(report:PdfReport,filename:string):Promise<Response>{const source=await report.bytes(),bytes=new Uint8Array(source.byteLength);bytes.set(source);return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="'+filename.replace(/[^a-z0-9._-]+/gi,'-')+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
