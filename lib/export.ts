import {PDFDocument,rgb,degrees,type PDFFont,type PDFPage,PDFName,PDFDict} from "pdf-lib";
import {blockStyle,type CVStyle,type TextStyle} from "./cv-style.ts";
import {normalizedEdit,type Block} from "./cv.ts";
const fontFiles={sans:"DejaVuSans",serif:"DejaVuSerif",mono:"DejaVuSansMono"};
export type FontLoader=(path:string)=>Promise<Uint8Array>;
const fetchFont:FontLoader=async path=>{const response=await fetch(path);if(!response.ok)throw new Error("The export font could not be loaded. Try again.");return new Uint8Array(await response.arrayBuffer());};
function color(hex:string){const valid=/^[0-9a-f]{6}$/i.test(hex)?hex:"111111";return rgb(...[0,2,4].map(n=>parseInt(valid.slice(n,n+2),16)/255) as [number,number,number]);}
function wrap(text:string,font:PDFFont,size:number,width:number){
  const lines:string[]=[];let line="";
  for(const word of text.split(/\s+/)){const next=line?`${line} ${word}`:word;if(font.widthOfTextAtSize(next,size)<=width){line=next;continue;}if(line){lines.push(line);line="";}if(font.widthOfTextAtSize(word,size)<=width){line=word;continue;}let part="";for(const char of word){if(part&&font.widthOfTextAtSize(part+char,size)>width){lines.push(part);part="";}part+=char;}line=part;}
  if(line)lines.push(line);return lines;
}
export async function exportPDF(blocks:Block[],style:CVStyle,loadFont:FontLoader=fetchFont):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();pdf.setTitle(blocks[0]?.text||"CV");pdf.setAuthor("");pdf.setCreator("");pdf.setProducer("");
  const fontkit=(await import("@pdf-lib/fontkit")).default;pdf.registerFontkit(fontkit);
  const fonts=new Map<string,PDFFont>();
  async function fontFor(s:TextStyle,text:string){
    const key=`${s.family}:${s.bold}`;
    if(!fonts.has(key))fonts.set(key,await pdf.embedFont(await loadFont(`/fonts/${fontFiles[s.family]}${s.bold?"-Bold":""}.ttf`),{subset:true}));
    const font=fonts.get(key)!,characters=new Set(font.getCharacterSet());
    if(Array.from(text).some(char=>!characters.has(char.codePointAt(0)!)))throw new Error("A character in this CV is not supported by the PDF font. Download DOCX or plain text instead.");
    return font;
  }

  const width=style.pageWidth,height=style.pageHeight,margin=Math.max(24,Math.min(style.margin,width/4)),contentWidth=width-margin*2;
  let page:PDFPage=pdf.addPage([width,height]),y=height-margin;
  const nextPage=()=>{page=pdf.addPage([width,height]);y=height-margin;};
  for(let index=0;index<blocks.length;index++){
    const block=blocks[index],s=blockStyle(block,index,style),font=await fontFor(s,block.text),bullet=/^[•●▪*-]\s*/.test(block.text),text=bullet?block.text.replace(/^[•●▪*-]\s*/,""):block.text;
    const indent=bullet?s.size*1.2:0,lines=wrap(text,font,s.size,contentWidth-indent),leading=s.size*style.lineHeight,before=block.heading?s.size*.9:0,after=index===0?s.size*.3:bullet?3:4;
    // Keep a heading with at least two following lines. Long paragraphs can flow.
    const keep=before+leading*(block.heading?3:Math.min(lines.length,3))+after;if(y-keep<margin)nextPage();y-=before;
    for(let i=0;i<lines.length;i++){
      if(y-leading<margin)nextPage();const line=lines[i],lineWidth=font.widthOfTextAtSize(line,s.size),x=s.align==="center"?(width-lineWidth)/2:s.align==="right"?width-margin-lineWidth:margin+indent;
      y-=leading;page.drawText(line,{x,y,size:s.size,font,color:color(s.color),xSkew:s.italic?degrees(12):undefined});
      if(bullet&&i===0)page.drawText("•",{x:margin,y,size:s.size,font:await fontFor(s,"•"),color:color(s.color)});
    }
    if(block.heading&&style.headingRule){page.drawLine({start:{x:margin,y:y-4},end:{x:width-margin,y:y-4},thickness:.5,color:color(s.color)});y-=5;}
    y-=after;
  }
  const info=pdf.context.lookup(pdf.context.trailerInfo.Info,PDFDict);info.delete(PDFName.of("CreationDate"));info.delete(PDFName.of("ModDate"));
  return pdf.save();
}
export async function patchDOCX(bytes:ArrayBuffer,original:Block[],current:Block[]):Promise<Blob>{
  const JSZip=(await import("jszip")).default,zip=await JSZip.loadAsync(bytes),xml=await zip.file("word/document.xml")!.async("string"),doc=new DOMParser().parseFromString(xml,"application/xml");
  const paragraphs=Array.from(doc.getElementsByTagName("w:p")),mapped=new Map<string,Element>();let cursor=0;
  for(const old of original){const index=paragraphs.findIndex((p,i)=>i>=cursor&&normalizedEdit(Array.from(p.getElementsByTagName("w:t")).map(t=>t.textContent||"").join(""))===normalizedEdit(old.text));if(index>=0){mapped.set(old.id,paragraphs[index]);cursor=index+1;}}
  for(const block of current){const old=original.find(b=>b.id===block.id);if(!old||old.text===block.text)continue;
    const paragraph=mapped.get(block.id);
    if(!paragraph)throw new Error("This edit could not be mapped to the original DOCX paragraph. Download PDF or plain text instead.");
    const nodes=Array.from(paragraph.getElementsByTagName("w:t")),before=nodes.map(n=>n.textContent||"").join(""),after=block.text;let start=0,suffix=0;
    while(start<Math.min(before.length,after.length)&&before[start]===after[start])start++;
    while(suffix<Math.min(before.length,after.length)-start&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
    const end=before.length-suffix,replacement=after.slice(start,after.length-suffix);let offset=0,inserted=false;
    for(const node of nodes){const value=node.textContent||"",nodeEnd=offset+value.length;if((nodeEnd>start||start===before.length&&node===nodes.at(-1))&&offset<=end){const prefix=value.slice(0,Math.max(0,start-offset)),tail=value.slice(Math.max(0,end-offset));node.textContent=prefix+(!inserted?replacement:"")+tail;inserted=true;node.setAttribute("xml:space","preserve");}offset=nodeEnd;}
  }
  zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));return zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}
