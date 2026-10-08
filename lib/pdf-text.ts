export type PDFTextItem = {str:string;transform:number[];width:number;hasEOL?:boolean};
export function pdfItemsToText(items:PDFTextItem[]) {
  const rows:{y:number;height:number;items:PDFTextItem[]}[]=[];
  for(const item of items){
    if(!item.str.trim())continue;
    const y=item.transform[5],height=Math.abs(item.transform[3])||10;
    const row=rows.find(r=>Math.abs(r.y-y)<=Math.max(2,Math.min(r.height,height)*.25));
    if(row)row.items.push(item);else rows.push({y,height,items:[item]});
  }
  rows.sort((a,b)=>b.y-a.y);
  return rows.map(row=>{
    row.items.sort((a,b)=>a.transform[4]-b.transform[4]);let text="",endX:number|undefined;
    for(const item of row.items){
      const gap=endX===undefined?0:item.transform[4]-endX;
      const space=text&&!/\s$/.test(text)&&!/^\s/.test(item.str)&&gap>row.height*.12?" ":"";
      text+=space+item.str;endX=item.transform[4]+item.width;
    }
    return text.replace(/\s+/g," ").trim();
  }).filter(Boolean).join("\n");
}
