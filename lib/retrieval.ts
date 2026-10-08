export function relevantPassages(text:string,query:string,budget:number) {
  if(text.length<=budget)return text;
  const terms=new Set(query.toLowerCase().match(/[a-z][a-z0-9+-]{3,}/g)||[]);
  const chunks=text.split(/\n\s*\n|(?<=[.!?])\s+/).flatMap(p=>p.match(/[\s\S]{1,700}/g)||[]).map((text,index)=>({text,index,score:[...terms].reduce((n,t)=>n+(text.toLowerCase().includes(t)?1:0),0)}));
  chunks.sort((a,b)=>b.score-a.score||a.index-b.index);
  let used=0;const selected=chunks.filter(c=>{if(used+c.text.length+2>budget)return false;used+=c.text.length+2;return true;});
  return selected.length?selected.sort((a,b)=>a.index-b.index).map(c=>c.text).join("\n\n"):chunks[0]?.text.slice(0,budget)||"";
}
