import {HEADINGS,normalizedEdit,parseCV,type Block} from "./cv.ts";
import {pdfRows,type PDFTextItem} from "./pdf-text.ts";
export type TextStyle={fontName:string;family:"sans"|"serif"|"mono";size:number;bold:boolean;italic:boolean;color:string;align:"left"|"center"|"right"};
export type CVStyle={body:TextStyle;name:TextStyle;heading:TextStyle;pageWidth:number;pageHeight:number;margin:number;lineHeight:number;headingRule:boolean;blocks:Record<string,TextStyle>;source:"pdf"|"docx"|"text"};
const base:TextStyle={fontName:"Arial",family:"sans",size:10.5,bold:false,italic:false,color:"111111",align:"left"};
export function defaultCVStyle():CVStyle{return {body:{...base},name:{...base,size:21,bold:true},heading:{...base,size:11,bold:true},pageWidth:595.28,pageHeight:841.89,margin:40,lineHeight:1.2,headingRule:false,blocks:{},source:"text"};}
export function fontFamily(name:string):TextStyle["family"]{return /courier|mono|consolas/i.test(name)?"mono":/times|serif|georgia|garamond|cambria|roman/i.test(name)&&! /sans/i.test(name)?"serif":"sans";}
export function textStyle(name:string,size:number,color="111111",align:TextStyle["align"]="left"):TextStyle{return {fontName:name.replace(/^[A-Z]{6}\+/,""),family:fontFamily(name),size:Math.max(8,Math.min(size,36)),bold:/bold|demi|black|semibold/i.test(name),italic:/italic|oblique/i.test(name),color,align};}
export type StyledPDFPage={width:number;height:number;items:(PDFTextItem&{fontName?:string})[];fonts:Record<string,string>;colors:Record<string,string>;hasRules:boolean};
export function inferPDFStyle(pages:StyledPDFPage[],text:string):CVStyle{
  const style=defaultCVStyle();style.source="pdf";const first=pages[0];if(!first)return style;
  style.pageWidth=first.width;style.pageHeight=first.height;
  const records=pages.flatMap(page=>pdfRows(page.items).map(row=>{const item=row.items.reduce((a,b)=>a.str.length>b.str.length?a:b) as PDFTextItem&{fontName?:string};const name=page.fonts[item.fontName||""]||"Arial";const center=(row.x+row.width/2);return {text:row.text,x:row.x,y:row.y,style:textStyle(name,row.height,page.colors[normalizedEdit(row.text)]||"111111",Math.abs(center-page.width/2)<15&&row.x>55?"center":"left")};}));
  const counts=new Map<string,{count:number;style:TextStyle}>();for(const row of records){if(HEADINGS.test(row.text)||row===records[0])continue;const key=`${row.style.fontName}:${row.style.size}`;const c=counts.get(key)||{count:0,style:row.style};c.count+=row.text.length;counts.set(key,c);}
  style.body={...(Array.from(counts.values()).sort((a,b)=>b.count-a.count)[0]?.style||style.body),bold:false,align:"left"};
  style.name={...records[0]?.style||style.name};style.heading={...records.find(r=>HEADINGS.test(r.text))?.style||style.heading};
  const lefts=records.filter(r=>r.style.align==="left").map(r=>r.x);style.margin=Math.max(24,Math.min(80,Math.min(...lefts)));
  style.headingRule=pages.some(p=>p.hasRules);
  const gaps=records.slice(1).flatMap((r,i)=>{const gap=records[i].y-r.y;return gap>style.body.size&&gap<style.body.size*1.8?[gap/style.body.size]:[];});
  style.lineHeight=gaps.length?Math.max(1.1,Math.min(1.5,gaps.sort((a,b)=>a-b)[Math.floor(gaps.length/2)])):1.2;
  for(const block of parseCV(text)){const row=records.find(r=>normalizedEdit(block.text).startsWith(normalizedEdit(r.text)));if(row)style.blocks[block.id]=row.style;}
  return style;
}
export function inferDOCXStyle(xml:string,text:string):CVStyle{
  const style=defaultCVStyle();style.source="docx";const doc=new DOMParser().parseFromString(xml,"application/xml");
  const val=(node:Element|Document,tag:string,attr="val")=>node.getElementsByTagName(`w:${tag}`)[0]?.getAttribute(`w:${attr}`)||"";
  const name=val(doc,"rFonts","ascii")||"Arial";const size=Number(val(doc,"sz"))/2||10.5;style.body=textStyle(name,size);
  const paragraphs=Array.from(doc.getElementsByTagName("w:p"));
  const records=paragraphs.map(p=>{const text=Array.from(p.getElementsByTagName("w:t")).map(t=>t.textContent||"").join("");const font=val(p,"rFonts","ascii")||name,s=Number(val(p,"sz"))/2||size,color=val(p,"color");return {text,style:{...textStyle(font,s,/^[0-9a-f]{6}$/i.test(color)?color:"111111"),bold:p.getElementsByTagName("w:b").length>0,italic:p.getElementsByTagName("w:i").length>0,align:(["center","right"].includes(val(p,"jc"))?val(p,"jc"):"left") as TextStyle["align"]}};}).filter(r=>r.text.trim());
  style.name={...records[0]?.style||style.name};style.heading={...records.find(r=>HEADINGS.test(r.text))?.style||style.heading};style.headingRule=doc.getElementsByTagName("w:pBdr").length>0;
  const page=doc.getElementsByTagName("w:pgSz")[0];if(page){style.pageWidth=Number(page.getAttribute("w:w"))/20||style.pageWidth;style.pageHeight=Number(page.getAttribute("w:h"))/20||style.pageHeight;}
  const margins=doc.getElementsByTagName("w:pgMar")[0];style.margin=Number(margins?.getAttribute("w:left"))/20||40;
  for(const block of parseCV(text)){const row=records.find(r=>normalizedEdit(r.text)===normalizedEdit(block.text));if(row)style.blocks[block.id]=row.style;}
  return style;
}
export function blockStyle(block:Block,index:number,style:CVStyle):TextStyle{return style.blocks[block.id]||(index===0?style.name:block.heading?style.heading:style.body);}
export function cssFont(style:TextStyle){return style.family==="serif"?'"Times New Roman", Georgia, serif':style.family==="mono"?'"Courier New", monospace':'Arial, Helvetica, sans-serif';}
