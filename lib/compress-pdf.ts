import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';

function ascii85(input: Uint8Array) {
 const output: number[]=[];let group:number[]=[];
 const flush=()=>{let value=0;for(const n of group)value=value*85+n;output.push((value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255);group=[]};
 for(const char of input){if(char===126)break;if(char<=32)continue;if(char===122&&group.length===0){output.push(0,0,0,0);continue}if(char<33||char>117)throw new Error('Invalid ASCII85');group.push(char-33);if(group.length===5)flush()}
 if(group.length){const count=group.length;if(count===1)throw new Error('Invalid ASCII85 tail');while(group.length<5)group.push(84);flush();output.length-=5-count}
 return Buffer.from(output);
}

// Rewrite image streams only: page content, text, links and layout remain intact.
export async function compressPdf(original: Buffer) {
 const unchanged = (reason: string) => ({ bytes: original, reason });
 try {
  if (/\/ByteRange\s*\[/.test(original.toString('latin1'))) return unchanged('signed');
  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  const objects = pdf.context.enumerateIndirectObjects();
  if (objects.some(([,o]) => o instanceof PDFDict && (o.has(PDFName.of('ByteRange')) || o.get(PDFName.of('FT'))?.toString()==='/Sig' || o.get(PDFName.of('Type'))?.toString()==='/Sig'))) return unchanged('signed');
  const start = Date.now();
  for (const [ref,obj] of objects) {
   if (Date.now()-start>15000) return unchanged('timeout');
   if (!(obj instanceof PDFRawStream)) continue;
   const d=obj.dict, value=(key:string)=>d.get(PDFName.of(key))?.toString();
   const filter=value('Filter')?.replace(/\s/g,'');
   if(value('Subtype')!=='/Image'||!['/DCTDecode','[/ASCII85Decode/DCTDecode]'].includes(filter||'')||value('ColorSpace')!=='/DeviceRGB'||d.has(PDFName.of('SMask'))||d.has(PDFName.of('Mask'))||d.has(PDFName.of('Decode'))) continue;
   const input=filter==='[/ASCII85Decode/DCTDecode]'?ascii85(obj.getContents()):obj.getContents();
   if(input.length<50000) continue;
   // DCTDecode must really contain JPEG, never let libvips auto-detect AVIF/HEIF here.
   if(input[0]!==0xff || input[1]!==0xd8 || input[2]!==0xff) continue;
   const {data,info}=await sharp(input,{limitInputPixels:40000000}).timeout({seconds:8}).resize(2000,2000,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85,chromaSubsampling:'4:4:4'}).toBuffer({resolveWithObject:true});
   if(data.length>=input.length) continue;
   const dict=d.clone(pdf.context);dict.set(PDFName.of('Filter'),PDFName.of('DCTDecode'));dict.set(PDFName.of('Width'),PDFNumber.of(info.width));dict.set(PDFName.of('Height'),PDFNumber.of(info.height));dict.set(PDFName.of('BitsPerComponent'),PDFNumber.of(8));dict.set(PDFName.of('Length'),PDFNumber.of(data.length));dict.delete(PDFName.of('DecodeParms'));
   pdf.context.assign(ref,PDFRawStream.of(dict,data));
  }
  const bytes=Buffer.from(await pdf.save({useObjectStreams:true,updateFieldAppearances:false}));
  return bytes.length<original.length ? {bytes,reason:'compressed'} : unchanged('unchanged');
 } catch { return unchanged('unsupported'); }
}

