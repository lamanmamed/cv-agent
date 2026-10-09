import type {Block} from "./cv.ts";
export type PDFRowAnchor={text:string};
export type PDFAnchor={page:number;firstRow:number;lastRow:number};

/** Matches extracted CV blocks back onto original PDF rows without modifying the PDF. */
export function normalizePDFAnchor(text:string):string {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[\u00ad\u200b]/g,"").replace(/[\u2010-\u2015]/g,"-")
    .replace(/^[\u2022\u25cf\u25aa*-]\s*/,"")
    .replace(/\s+/g," ").trim();
}
export function findPDFAnchors(blocks:Pick<Block,"id"|"text">[],pages:PDFRowAnchor[][]):Record<string,PDFAnchor>{
  const matches:Record<string,PDFAnchor>={};
  const used=new Set<string>();
  for(const block of blocks){
    const target=normalizePDFAnchor(block.text);
    if(!target||target.length<3)continue;
    let candidate:{page:number;firstRow:number;lastRow:number;rank:number}|null=null;
    for(let p=0;p<pages.length;p++){
      const rows=pages[p];
      for(let start=0;start<rows.length;start++){
        let combined="";
        for(let end=start;end<Math.min(rows.length,start+7);end++){
          combined+= (end===start?"":" ")+rows[end].text;
          const normalized=normalizePDFAnchor(combined);
          const exact=normalized===target;
          const partial=target.length>=30&&normalized.includes(target)&&normalized.length<=target.length+8;
          if(!exact&&!partial)continue;
          const keys=Array.from({length:end-start+1},(_,i)=>`${p}:${start+i}`);
          if(keys.some(k=>used.has(k)))continue;
          const rank=exact?0:1;
          if(!candidate||rank<candidate.rank)candidate={page:p,firstRow:start,lastRow:end,rank};
          if(rank===0)break;
        }
        if(candidate?.rank===0)break;
      }
      if(candidate?.rank===0)break;
    }
    if(candidate){
      matches[block.id]={page:candidate.page,firstRow:candidate.firstRow,lastRow:candidate.lastRow};
      for(let r=candidate.firstRow;r<=candidate.lastRow;r++)used.add(`${candidate.page}:${r}`);
    }
  }
  return matches;
}
