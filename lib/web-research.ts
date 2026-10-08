import {boundedFetchText} from "./api.ts";
import type {CompanyResearch,ResearchSource} from "./cv.ts";

// User-supplied websites are read through a fixed public reader endpoint. They
// are never requested directly from the application server's network.
export function publicWebURL(value:string) {
  const url=new URL(value);
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"");
  if(url.protocol!=="https:"||url.username||url.password||url.port)throw new Error("Use a public HTTPS URL without credentials or a custom port.");
  if(!host.includes(".")||host.includes(":")||/^[\d.]+$/.test(host)||/(^|\.)(localhost|local|internal|test|invalid|example|onion|arpa)$/.test(host))throw new Error("Use a public website, not a local or private address.");
  if(host==="metadata.google.internal"||host.endsWith(".nip.io")||host.endsWith(".sslip.io"))throw new Error("Use a public website address.");
  url.hash="";return url;
}
export function markdownLinks(text:string) {
  return Array.from(text.matchAll(/\[([^\]]{1,150})\]\((https?:\/\/[^\s)]+)\)/g)).flatMap(match=>{
    try {const url=publicWebURL(match[2]);return [{title:match[1],url:url.href}];}catch{return [];}
  });
}
export function cleanWebText(text:string) {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g,"").replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/^#{1,6}\s*/gm,"").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
export async function readPublicPage(value:string):Promise<ResearchSource> {
  const url=publicWebURL(value);
  const raw=await boundedFetchText(`https://r.jina.ai/${url.href}`,{Accept:"application/json","X-Return-Format":"markdown","X-With-Links-Summary":"true","X-Timeout":"20"},600000,25000);
  const result=JSON.parse(raw) as {data?:{title?:string;url?:string;content?:string};code?:number;message?:string};
  if(!result.data?.content||result.code&&result.code!==200)throw new Error("This page could not be read. It may require a login or block automated access. Paste its text instead.");
  const text=result.data.content.trim();
  if(text.length<80||/^(?:access denied|just a moment|sign in to continue)/i.test(cleanWebText(text)))throw new Error("This page blocks automated reading. Paste its text instead.");
  return {id:crypto.randomUUID(),url:url.href,title:result.data.title||url.hostname,text:text.slice(0,30000)};
}
export function inferCompanyURL(jobURL:string,text:string) {
  const url=publicWebURL(jobURL);
  const shared=/greenhouse\.io$|lever\.co$|ashbyhq\.com$|linkedin\.com$|indeed\.|myworkdayjobs\.com$|workday\.com$|smartrecruiters\.com$|workable\.com$|icims\.com$|successfactors\.|recruitee\.com$|bamboohr\.com$/i;
  if(!shared.test(url.hostname))return new URL(`https://${url.hostname.replace(/^(careers|career|jobs|job|recruitment)\./,"")}`).href;
  const links=markdownLinks(text);
  const official=links.find(l=>/^(company website|visit (our |the )?website|our website|company homepage|about (us|the company))$/i.test(l.title.trim())&&!shared.test(new URL(l.url).hostname));
  return official?.url||"";
}
export function companyPageLinks(home:ResearchSource) {
  const host=new URL(home.url).hostname.replace(/^www\./,"");
  const links=markdownLinks(home.text).filter(l=>{
    const target=new URL(l.url),other=target.hostname.replace(/^www\./,"");
    return (other===host||other.endsWith("."+host))&& !/\.(pdf|png|jpe?g|zip|mp4)(\?|$)/i.test(target.pathname) && !/privacy|cookie|login|sign.?in|legal|terms|accessibility/i.test(l.title+target.pathname)&&/about|company|what.we.do|product|service|business|mission|value|culture|career|news|press|strategy|sustainab|annual/i.test(l.title+target.pathname);
  });
  const rank=(l:{title:string;url:string})=> /about|what.we.do|mission|strateg/i.test(l.title+l.url)?0:/product|service|business/i.test(l.title+l.url)?1:/culture|value|career/i.test(l.title+l.url)?2:3;
  links.sort((a,b)=>rank(a)-rank(b));
  const seen=new Set([new URL(home.url).href.replace(/\/$/,"")]);
  return links.filter(l=>{const key=l.url.replace(/\/$/,"");if(seen.has(key))return false;seen.add(key);return true;}).slice(0,7);
}
export async function researchCompany(value:string):Promise<CompanyResearch> {
  const home=await readPublicPage(value),sources=[{...home,text:cleanWebText(home.text).slice(0,7000)}],failures:string[]=[];
  const candidates=companyPageLinks(home);
  // Two requests at a time keep anonymous reader usage bounded.
  for(let i=0;i<candidates.length;i+=2){
    const batch=candidates.slice(i,i+2),result=await Promise.allSettled(batch.map(p=>readPublicPage(p.url)));
    result.forEach((page,j)=>{if(page.status==="fulfilled")sources.push({...page.value,text:cleanWebText(page.value.text).slice(0,7000)});else failures.push(batch[j].url);});
  }
  return {url:home.url,sources,failures};
}
