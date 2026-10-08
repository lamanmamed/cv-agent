import { z } from "zod";
import { boundedFetchText, jsonResponse, readJSON } from "@/lib/api";
import { redactSecrets } from "@/lib/import";
import {publicWebURL,readPublicPage,cleanWebText,inferCompanyURL} from "@/lib/web-research";
const inputSchema = z.object({kind:z.enum(["github","job"]),url:z.string().url().max(1000)});
const segment = /^[A-Za-z0-9._-]+$/;
export function parseImportURL(value: string, kind: "github" | "job") {
  const url = kind==="job"?publicWebURL(value):new URL(value);
  if(url.protocol!=="https:"||url.username||url.password||url.port) throw new Error("Use a plain HTTPS link without credentials or a custom port.");
  const path=url.pathname.split("/").filter(Boolean);
  if(kind==="github"&&!path.every(p=>segment.test(p))) throw new Error("Use a GitHub profile or repository link.");
  const hosts = kind==="github"?["github.com","www.github.com"]:["boards.greenhouse.io","job-boards.greenhouse.io","jobs.lever.co","jobs.eu.lever.co","jobs.ashbyhq.com"];
  if(kind==="github"&&!hosts.includes(url.hostname)) throw new Error("Use a github.com repository or profile link.");
  if(kind==="github"&&(path.length<1||path.length>2)) throw new Error("Use a GitHub profile or repository URL, without a file path.");
  return {url,path};
}
function plainHTML(input: string) {
  return input.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<\/?(?:p|div|h[1-6]|li|ul|br)\b[^>]*>/gi,"\n").replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#(?:39|x27);/g,"'").replace(/&nbsp;/g," ").replace(/\n\s*\n/g,"\n").trim();
}
async function getJSON(url:string) {return JSON.parse(await boundedFetchText(url,{Accept:"application/json","User-Agent":"cv-agent"}));}
export async function POST(request:Request) {
  try {
    const input=inputSchema.parse(await readJSON(request,3000)); const {url,path}=parseImportURL(input.url,input.kind);
    if(input.kind==="github") {
      let repos: string[];
      if(path.length===2) repos=[`${path[0]}/${path[1]}`.replace(/\.git$/,"")];
      else {
        const data=await getJSON(`https://api.github.com/users/${encodeURIComponent(path[0])}/repos?sort=updated&per_page=10`);
        repos=(data as {full_name:string;fork:boolean}[]).filter(r=>!r.fork).slice(0,3).map(r=>r.full_name);
      }
      const sources=[];
      for(const repo of repos) {
        try {
          const text=redactSecrets(await boundedFetchText(`https://api.github.com/repos/${repo}/readme`,{Accept:"application/vnd.github.raw+json","User-Agent":"cv-agent"},15000));
          if(text.trim()) sources.push({id:crypto.randomUUID(),name:`github.com/${repo}/README`,text:text.slice(0,8000)});
        } catch { /* A repository without a readable README is skipped. */ }
      }
      if(!sources.length) return jsonResponse({error:"No public README was found. Use a repository with a README or upload a project summary."},400);
      return jsonResponse({sources});
    }
    let text="",companyURL="";
    if(["boards.greenhouse.io","job-boards.greenhouse.io"].includes(url.hostname)&&path.length===3&&path[1]==="jobs"&&/^\d+$/.test(path[2])) {
      if(path.length!==3||path[1]!=="jobs"||!/^\d+$/.test(path[2])) throw new Error("Use a Greenhouse link ending in /company/jobs/job-id, or paste the description.");
      const data=await getJSON(`https://boards-api.greenhouse.io/v1/boards/${path[0]}/jobs/${path[2]}?content=true`);
      text=`${data.title||""}\n${data.location?.name||""}\n${plainHTML(data.content||"")}`;
    } else if(["jobs.lever.co","jobs.eu.lever.co"].includes(url.hostname)&&path.length===2) {
      if(path.length!==2) throw new Error("Use a link to one Lever job, or paste the description.");
      const host=url.hostname==="jobs.eu.lever.co"?"api.eu.lever.co":"api.lever.co";
      const data=await getJSON(`https://${host}/v0/postings/${path[0]}/${path[1]}?mode=json`);
      text=[data.text,data.descriptionPlain||plainHTML(data.description||""),...(data.lists||[]).map((l:{text:string;content:string})=>`${l.text}\n${plainHTML(l.content)}`),data.additionalPlain||plainHTML(data.additional||"")].filter(Boolean).join("\n");
    } else if(url.hostname==="jobs.ashbyhq.com"&&path.length===2) {
      if(path.length!==2) throw new Error("Use a link to one Ashby job, or paste the description.");
      const data=await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${path[0]}`);
      const found=(data.jobs||[]).find((j:{jobUrl:string})=>new URL(j.jobUrl).pathname.replace(/\/$/,"")===url.pathname.replace(/\/$/,""));
      if(!found) throw new Error("This job is no longer listed. Paste a saved description instead.");
      text=`${found.title||""}\n${found.descriptionPlain||plainHTML(found.descriptionHtml||"")}`;
    } else {
      const page=await readPublicPage(url.href);
      text=cleanWebText(page.text).slice(0,15000);companyURL=inferCompanyURL(url.href,page.text);
    }
    if(text.trim().length<40) throw new Error("No complete job description was found. Paste it instead.");
    if(text.length>15000) throw new Error("The description is too long. Paste only the relevant requirements and responsibilities.");
    return jsonResponse({text,companyURL:companyURL||inferCompanyURL(url.href,""),url:url.href});
  } catch(error) {return jsonResponse({error:error instanceof z.ZodError?"Provide a valid job or GitHub URL.":error instanceof Error?error.message:"The link could not be read. Paste the text instead."},400);}
}
