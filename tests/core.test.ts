import {test} from "node:test";
import assert from "node:assert/strict";
import {applyDecision,parseCV,localAnalysis,validateSuggestions,keywordReport,isMeaningfulEdit,filterReviewedEdits,SAMPLE_CV,SAMPLE_JOB,SAMPLE_EVIDENCE,type Suggestion} from "../lib/cv.ts";
import {pdfItemsToText} from "../lib/pdf-text.ts";
import {publicWebURL,researchCompany,readPublicPage} from "../lib/web-research.ts";
import {readEvidence,redactSecrets} from "../lib/import.ts";
import {readJSON} from "../lib/api.ts";
import JSZip from "jszip";
import {POST as analyzeRequest} from "../app/api/analyze/route.ts";
function reviewFixture():Suggestion[]{
  const block=parseCV(SAMPLE_CV).find(b=>b.text.includes("Responsible for analyzing"))!;
  return [{id:"test-edit",blockId:block.id,original:block.text,suggested:"• Analyzed customer data using Python and SQL.",reason:"Clarifies the documented analysis contribution.",status:"pending",citations:[{sourceId:block.id,quote:block.text}]}];
}

test("accept, reject and undo alter only the selected line",()=>{
  const blocks=parseCV(SAMPLE_CV),initial=reviewFixture();
  const first=initial[0], accepted=applyDecision(blocks,initial,first.id,"accepted");
  assert.equal(accepted.blocks.find(b=>b.id===first.blockId)?.text,first.suggested);
  assert.deepEqual(accepted.blocks.filter(b=>b.id!==first.blockId),blocks.filter(b=>b.id!==first.blockId));
  const undo=applyDecision(accepted.blocks,accepted.suggestions,first.id,"pending"); assert.deepEqual(undo.blocks,blocks);
  const rejected=applyDecision(blocks,initial,first.id,"rejected");assert.deepEqual(rejected.blocks,blocks);
});
test("stale proposals cannot overwrite a manually changed line",()=>{
  const blocks=parseCV(SAMPLE_CV),suggestions=reviewFixture(),first=suggestions[0];
  const changed=blocks.map(b=>b.id===first.blockId?{...b,text:"Updated by the user"}:b);
  assert.throws(()=>applyDecision(changed,suggestions,first.id,"accepted"),/changed/);
});
test("citation, metric, skill, duplicate and original validation",()=>{
  const blocks=parseCV(SAMPLE_CV),s=reviewFixture()[0];
  assert.equal(validateSuggestions([s],blocks,[]).length,1);
  assert.throws(()=>validateSuggestions([{...s,citations:[{sourceId:s.blockId,quote:"Invented evidence."}]}],blocks,[]),/citation/);
  assert.throws(()=>validateSuggestions([{...s,suggested:s.suggested+" Improved results by 47%."}],blocks,[]),/number/);
  assert.throws(()=>validateSuggestions([{...s,suggested:s.suggested+" Deployed using Kubernetes."}],blocks,[]),/unsupported Kubernetes/);
  assert.throws(()=>validateSuggestions([s,s],blocks,[]),/duplicated/);
  assert.throws(()=>validateSuggestions([{...s,original:"Different text"}],blocks,[]),/target/);
});
test("local checks do not pretend to generate AI rewrites",()=>{
  assert.deepEqual(localAnalysis(parseCV("Name\nBaku,  Azerbaijan | email@example.com\nEDUCATION\nMSc  Artificial Intelligence"),SAMPLE_JOB,[]).suggestions,[]);
  assert.equal(isMeaningfulEdit("MSc  Artificial Intelligence","MSc Artificial Intelligence"),false);
  const s=reviewFixture()[0];assert.throws(()=>validateSuggestions([{...s,suggested:s.original.replace(/ /g,"  ")}],parseCV(SAMPLE_CV),[]),/cosmetic/);
});
test("reviewed targets are not suggested again on repeated analysis",()=>{
  const s=reviewFixture()[0];
  for(const status of ["accepted","rejected","pending"] as const)assert.equal(filterReviewedEdits([s],[{...s,status}]).length,0);
  assert.equal(filterReviewedEdits([s],[{...s,blockId:"other",status:"rejected"}]).length,1);
});
test("PDF fragments preserve ligatures and bullets reflow into one paragraph",()=>{
  const items=[{str:"Arti",transform:[1,0,0,10,0,100],width:14},{str:"fi",transform:[1,0,0,10,14,100],width:5},{str:"cial",transform:[1,0,0,10,19,100],width:14},{str:"Intelligence",transform:[1,0,0,10,37,100],width:50}];
  assert.equal(pdfItemsToText(items),"Artificial Intelligence");
  const blocks=parseCV("EXPERIENCE\nCompany | Data Scientist\n• Built a model to predict\npatient outcomes using Python.\nEDUCATION\nExample University\nMSc AI 2025–2026");
  assert.equal(blocks[2].text,"• Built a model to predict patient outcomes using Python.");assert.ok(blocks[3].heading);assert.equal(blocks.length,6);
});
test("general public links are allowed but private addresses are rejected",()=>{
  assert.equal(publicWebURL("https://careers.somecompany.com/role?job=5").hostname,"careers.somecompany.com");
  for(const url of ["https://localhost/a","https://127.0.0.1/a","https://127.1/a","https://[::1]/a","https://a.internal/a","http://www.company.com/a","https://user:pass@company.com/a","https://company.com:8443/a"])assert.throws(()=>publicWebURL(url));
});
test("company research follows bounded relevant sources and retains citations",async()=>{
  const originalFetch=globalThis.fetch,calls:string[]=[];
  globalThis.fetch=async(input)=>{
    const value=String(input);calls.push(value);assert.ok(value.startsWith("https://r.jina.ai/https://"));
    const home=value.endsWith("company.com/");
    return Response.json({code:200,data:{title:home?"Company":"About",content:home?"A company making healthcare analytics software with evidence-based tools. [About us](https://company.com/about) [Products](https://company.com/products) [Privacy](https://company.com/privacy)":"We develop healthcare analytics products that help research teams interpret evidence. Our engineers collaborate closely with data scientists."}});
  };
  try {const result=await researchCompany("https://company.com");assert.equal(result.sources.length,3);assert.equal(result.failures.length,0);assert.ok(result.sources.some(s=>s.url.endsWith("/products")));assert.ok(!calls.some(c=>c.endsWith("/privacy")));}
  finally {globalThis.fetch=originalFetch;}
});
test("unreadable public pages fail explicitly instead of inventing content",async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({code:403,message:"blocked"});
  try {await assert.rejects(()=>readPublicPage("https://company.com/careers"),/could not be read/);}finally{globalThis.fetch=originalFetch;}
});
test("missing requirements remain gaps and project-only mentions remain separate",()=>{
  const report=keywordReport(parseCV(SAMPLE_CV),SAMPLE_JOB,SAMPLE_EVIDENCE);
  assert.ok(report.matched.includes("Python"));assert.ok(report.evidenceOnly.includes("PyTorch"));assert.ok(report.missing.includes("Docker"));
  const boundary=keywordReport(parseCV("Uses JavaScript and NoSQL"),"Java SQL",[]);assert.equal(boundary.matched.length,0);
});
test("ZIP import reads text, skips sensitive directories and never executes code",async()=>{
  const zip=new JSZip();zip.file("README.md","A useful project written in Python.");zip.file(".env","API_KEY=secret-value");zip.file("node_modules/secret.js","throw Error('must never run')");zip.file("large.txt","x".repeat(16000));
  const bytes=await zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
  const file=new File([new Uint8Array(bytes).buffer],"project.zip");const result=await readEvidence(file);
  assert.equal(result.sources.length,1);assert.ok(result.sources[0].name.endsWith("README.md"));assert.equal(result.skipped,3);
  assert.ok(!redactSecrets("token gsk_abcdefghijklmnopqrstuvwxyz0123456789").includes("abcdefghijklmnopqrstuvwxyz"));
});
test("analysis requests reject cross-origin and oversized bodies",async()=>{
  await assert.rejects(()=>readJSON(new Request("https://cv.example/api/analyze",{method:"POST",headers:{origin:"https://other.example","content-type":"application/json"},body:"{}"})),/Cross-origin/);
  await assert.rejects(()=>readJSON(new Request("https://cv.example/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:'{"large":"abcdefgh"}'}),5),/too large/);
});


test("AI endpoint calls Groq, validates grounding, and suppresses reviewed edits",async()=>{
  const originalFetch=globalThis.fetch,blocks=parseCV(SAMPLE_CV),edit={...reviewFixture()[0],jobRequirement:"Requirements: Python, SQL, PyTorch, statistics, and data visualization."};let calls=0;
  globalThis.fetch=async(input,options)=>{
    calls++;assert.equal(String(input),"https://api.groq.com/openai/v1/chat/completions");
    const body=JSON.parse(String(options?.body));assert.equal(body.model,"openai/gpt-oss-20b");assert.equal(body.response_format.type,"json_schema");
    return Response.json({choices:[{message:{content:JSON.stringify({suggestions:[edit],insights:[]})}}]});
  };
  const send=(extra:object={})=>analyzeRequest(new Request("https://cv.example/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({blocks,job:SAMPLE_JOB,evidence:[],key:"test-key-no-real-secret",...extra})}));
  try {
    const success=await send();assert.equal(success.status,200);const data=await success.json() as {mode:string;suggestions:unknown[]};assert.equal(data.mode,"groq");assert.equal(data.suggestions.length,1);
    const repeated=await send({history:[{...edit,status:"rejected"}]});assert.equal((await repeated.json() as {suggestions:unknown[]}).suggestions.length,0);
    const disconnected=await send({key:""});assert.equal(disconnected.status,400);assert.equal(calls,2);
  }finally{globalThis.fetch=originalFetch;}
});
