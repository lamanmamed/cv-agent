export type PDFTextItem = {str:string;transform:number[];width:number;hasEOL?:boolean};
export function pdfRows(items:PDFTextItem[]) {
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
    const x=row.items[0].transform[4],width=Math.max(...row.items.map(i=>i.transform[4]+i.width))-x;
    return {...row,x,width,text:text.replace(/\s+/g," ").trim()};
  }).filter(row=>row.text);
}

export function pdfItemsToText(items:PDFTextItem[]){return pdfRows(items).map(row=>row.text).join("\n");}
