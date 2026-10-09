import {test} from "node:test";
import assert from "node:assert/strict";
import {applyDecision,parseCV,localAnalysis,validateSuggestions,keywordReport,isMeaningfulEdit,filterReviewedEdits,SAMPLE_CV,SAMPLE_JOB,SAMPLE_EVIDENCE,type Suggestion,descriptionError,isURLOnly} from "../lib/cv.ts";
import {pdfItemsToText} from "../lib/pdf-text.ts";
import {publicWebURL,researchCompany,readPublicPage} from "../lib/web-research.ts";
import {readEvidence,redactSecrets} from "../lib/import.ts";
import {readJSON,boundedFetchText} from "../lib/api.ts";
import JSZip from "jszip";
import {defaultCVStyle,inferPDFStyle} from "../lib/cv-style.ts";
import {exportPDF} from "../lib/export.ts";
import {layoutSafeExports,sameDocumentContent} from "../lib/document-preservation.ts";
import {readFile} from "node:fs/promises";
import {PDFDocument} from "pdf-lib";
import {POST as analyzeRequest} from "../app/api/analyze/route.ts";
import {POST as connectionRequest,GET as savedConnectionStatus} from "../app/api/ai-status/route.ts";
import {verifyReviewEdits} from "../lib/verify-review.ts";
import {outputJSON} from "../lib/ai-review-schema.ts";

// Route fixtures model the separate semantic-verification response as well as generation.
const mockVerifiedReview=(generate:typeof fetch):typeof fetch=>async(input,options)=>{
  const body=typeof options?.body==="string"?JSON.parse(options.body):null;
  if(body?.response_format?.json_schema?.schema?.properties?.checks){
    const context=JSON.parse(body.messages[1].content);
    return Response.json({choices:[{message:{content:JSON.stringify({checks:context.proposals.map((p:{blockId:string})=>({blockId:p.blockId,supported:true,reason:"The wording preserves the facts documented in the original CV line."}))})}}]});
  }
  return generate(input,options);
};

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
  globalThis.fetch=mockVerifiedReview(async(input,options)=>{
    calls++;assert.equal(String(input),"https://api.groq.com/openai/v1/chat/completions");
    const body=JSON.parse(String(options?.body));assert.equal(body.model,"openai/gpt-oss-20b");assert.equal(body.response_format.type,"json_schema");
    return Response.json({choices:[{message:{content:JSON.stringify({suggestions:[edit],comments:[{blockId:edit.blockId,kind:"question",text:"What outcome can you substantiate for this Python and SQL analysis?"}],insights:[]})}}]});
  });
  const send=(extra:object={})=>analyzeRequest(new Request("https://cv.example/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({blocks,job:SAMPLE_JOB,evidence:[],key:"test-key-no-real-secret",...extra})}));
  try {
    const success=await send();assert.equal(success.status,200);const data=await success.json() as {mode:string;suggestions:unknown[]};assert.equal(data.mode,"groq");assert.equal(data.suggestions.length,1);
    const repeated=await send({history:[{...edit,status:"rejected"}]});assert.equal((await repeated.json() as {suggestions:unknown[]}).suggestions.length,0);
    const disconnected=await send({key:""});assert.equal(disconnected.status,400);assert.equal(calls,2);
  }finally{globalThis.fetch=originalFetch;}
});


test("URL in description is rejected before any AI request",async()=>{
  const url="https://jobs.picnic.app/en/vacancies/J96UDJ5O/graduate-programs/analytics-future-leaders-graduate-program/amsterdam/north-holland/netherlands";
  assert.ok(isURLOnly(url));assert.match(descriptionError(url)!,/wrong thing/);assert.equal(descriptionError(SAMPLE_JOB),null);
  const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("must not call AI");};
  try{const response=await analyzeRequest(new Request("https://cv.example/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({blocks:parseCV(SAMPLE_CV),job:url,evidence:[],key:"test-key-no-real-secret"})}));assert.equal(response.status,400);assert.equal(calls,0);const data=await response.json() as {code:string};assert.equal(data.code,"INVALID_JOB_DESCRIPTION");}finally{globalThis.fetch=originalFetch;}
});
test("public reader uses Workers-compatible manual redirects",async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async(input,options)=>{assert.equal(options?.redirect,"manual");return new Response("Public source text.");};
  try{assert.equal(await boundedFetchText("https://r.jina.ai/https://company.com"),"Public source text.");globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:"https://private.internal"}});await assert.rejects(()=>boundedFetchText("https://r.jina.ai/https://company.com"),/redirected/);}finally{globalThis.fetch=originalFetch;}
});
test("empty AI reviews fail explicitly, and one invalid edit does not discard a valid edit",async()=>{
  const originalFetch=globalThis.fetch,blocks=parseCV(SAMPLE_CV),valid={...reviewFixture()[0],jobRequirement:"Requirements: Python, SQL, PyTorch, statistics, and data visualization."};let output:object={suggestions:[],comments:[],insights:[]};
  globalThis.fetch=mockVerifiedReview(async()=>Response.json({choices:[{message:{content:JSON.stringify(output)}}]}));
  const send=()=>analyzeRequest(new Request("https://cv.example/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({blocks,job:SAMPLE_JOB,evidence:[],key:"test-key-no-real-secret"})}));
  try{let response=await send();let data=await response.json() as {suggestions:unknown[];comments:unknown[];code?:string};assert.equal(response.status,502);assert.equal(data.code,"GROQ_EMPTY_REVIEW");assert.equal(data.comments,undefined);
    output={suggestions:[{...valid,jobRequirement:"Made up requirement outside the job"},valid],comments:[],insights:[]};response=await send();data=await response.json() as typeof data;assert.equal(response.status,200);assert.equal(data.suggestions.length,1);assert.ok(data.comments.length>0);
    output={suggestions:[{...valid,jobRequirement:valid.jobRequirement.replace(/ /g,"  ")}],comments:[],insights:[]};response=await send();data=await response.json() as typeof data;assert.equal(data.suggestions.length,1);
  }finally{globalThis.fetch=originalFetch;}
});


test("PDF styling uses the imported family, sizes and alignment instead of green template styling",()=>{
  const items=[{str:"Example Name",transform:[1,0,0,20,180,750],width:230,fontName:"name"},{str:"EXPERIENCE",transform:[1,0,0,12,45,700],width:90,fontName:"bold"},{str:"Documented original contribution",transform:[1,0,0,10,45,680],width:230,fontName:"body"}];
  const style=inferPDFStyle([{width:595,height:842,items,fonts:{name:"Times-Bold",bold:"Times-Bold",body:"Times-Roman"},colors:{experience:"333333"},hasRules:true}],"Example Name\nEXPERIENCE\nDocumented original contribution");
  assert.equal(style.body.family,"serif");assert.equal(style.body.size,10);assert.equal(style.name.size,20);assert.equal(style.name.align,"center");assert.equal(style.heading.color,"333333");assert.equal(style.headingRule,true);
});
test("PDF download embeds supported Unicode and omits app branding and timestamp metadata",async()=>{
  const style=defaultCVStyle(),blocks=parseCV("Əli Məmmədova\nBakı | example@example.com\nEXPERIENCE\n• Explained results using Python and SQL.");
  const bytes=await exportPDF(blocks,style,async path=>new Uint8Array(await readFile(new URL("../public"+path,import.meta.url))));
  const document=await PDFDocument.load(bytes,{updateMetadata:false});assert.equal(document.getPageCount(),1);assert.equal(document.getTitle(),"Əli Məmmədova");assert.equal(document.getCreator(),"");assert.equal(document.getProducer(),"");assert.equal(document.getCreationDate(),undefined);
});

const endpointResult=async(response:Response)=>await response.json() as {connected?:boolean;code?:string;retryAfter?:number;mode?:string;suggestions?:Suggestion[];comments?:{text:string;origin:string}[]};
const testKey="test-key-no-real-secret";
const aiComment={blockId:"",kind:"question",text:"Which outcome can you document for the customer retention dashboard?"};
const reviewRequest=(extra:object={})=>new Request("https://cv.example/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({blocks:parseCV(SAMPLE_CV),job:SAMPLE_JOB,evidence:[],key:testKey,...extra})});
const connectRequest=()=>new Request("https://cv.example/api/ai-status",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:testKey})});
const completion=(output:unknown,finish_reason="stop")=>Response.json({choices:[{finish_reason,message:{content:JSON.stringify(output)}}]});

test("connection verification generates with the exact review model and schema using only synthetic data",async()=>{
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(input,options)=>{
    calls++;assert.equal(String(input),"https://api.groq.com/openai/v1/chat/completions");
    const body=JSON.parse(String(options?.body));assert.equal(body.model,"openai/gpt-oss-20b");
    assert.equal(body.reasoning_effort,"low");assert.equal(body.response_format.json_schema.strict,true);assert.deepEqual(body.response_format.json_schema.schema,outputJSON);
    const expected=JSON.parse(body.messages[1].content);assert.equal(expected.comments[0].text,"AI connection test completed.");assert.ok(!JSON.stringify(body).includes("Avery"));
    return completion(expected);
  };
  try{const response=await connectionRequest(connectRequest());assert.equal(response.status,200);assert.equal((await endpointResult(response)).connected,true);assert.equal(calls,1);}
  finally{globalThis.fetch=originalFetch;}
});

test("connection is not ready when generation is empty, truncated, or has the wrong shape",async()=>{
  const originalFetch=globalThis.fetch;
  try{for(const output of [()=>Response.json({data:[{id:"openai/gpt-oss-20b"}]}),()=>completion({suggestions:[],comments:[],insights:[]}),()=>completion({},"length")]){
    globalThis.fetch=async()=>output();const response=await connectionRequest(connectRequest());const data=await endpointResult(response);assert.equal(response.status,502);assert.equal(data.connected,undefined);assert.ok(data.code);
  }}finally{globalThis.fetch=originalFetch;}
});

test("provider failures have safe specific diagnostics in both endpoints and are never auto-retried",async()=>{
  const originalFetch=globalThis.fetch;
  const cases=[
    {status:401,code:"GROQ_AUTH",message:"Invalid API Key",expected:401},
    {status:403,code:"GROQ_MODEL_ACCESS",message:"Model permission denied",expected:403},
    {status:413,code:"GROQ_INPUT_LIMIT",message:"Request too large",expected:413},
    {status:429,code:"GROQ_RATE_LIMIT",message:"Rate limit reached for tokens per minute",expected:429},
    {status:429,code:"GROQ_QUOTA",message:"Tokens per day quota reached",expected:429},
    {status:400,code:"GROQ_REQUEST_REJECTED",message:"response_format JSON schema rejected",expected:502},
    {status:503,code:"GROQ_UNAVAILABLE",message:"Service unavailable",expected:503},
  ];
  try{for(const fixture of cases){let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{message:`${fixture.message} ${testKey} PRIVATE_CV_TEXT`}},{status:fixture.status,headers:{"retry-after":"12"}});};
    for(const response of [await analyzeRequest(reviewRequest()),await connectionRequest(connectRequest())]){
      const data=await endpointResult(response);assert.equal(response.status,fixture.expected);assert.equal(data.code,fixture.code);assert.equal(data.mode,undefined);assert.equal(data.comments,undefined);
      assert.ok(!JSON.stringify(data).includes(testKey));assert.ok(!JSON.stringify(data).includes("PRIVATE_CV_TEXT"));if(fixture.status===429)assert.equal(data.retryAfter,12);
    }assert.equal(calls,2);
  }}finally{globalThis.fetch=originalFetch;}
});

test("timeouts and network failures do not become input errors or non-AI reviews",async()=>{
  const originalFetch=globalThis.fetch;
  try{for(const [error,code,status] of [[new DOMException("timeout","TimeoutError"),"GROQ_TIMEOUT",504],[new TypeError("fetch failed"),"GROQ_NETWORK",503]] as const){
    let calls=0;globalThis.fetch=async()=>{calls++;throw error;};const response=await analyzeRequest(reviewRequest());const data=await endpointResult(response);assert.equal(response.status,status);assert.equal(data.code,code);assert.equal(data.comments,undefined);assert.equal(calls,1);
  }}finally{globalThis.fetch=originalFetch;}
});

test("an empty review is repaired by AI and a comments-only response is genuinely AI-generated",async()=>{
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_input,options)=>{calls++;const body=JSON.parse(String(options?.body));if(calls===2)assert.match(body.messages[0].content,/Repair instructions/);return completion({suggestions:[],comments:calls===1?[]:[aiComment],insights:[]});};
  try{const response=await analyzeRequest(reviewRequest());const data=await endpointResult(response);assert.equal(response.status,200);assert.equal(data.mode,"groq");assert.deepEqual(data.suggestions,[]);assert.equal(data.comments?.[0]?.text,aiComment.text);assert.equal(data.comments?.[0]?.origin,"ai");assert.equal(calls,2);}
  finally{globalThis.fetch=originalFetch;}
});

test("all blocked edits get one grounding repair while unsupported facts remain blocked",async()=>{
  const originalFetch=globalThis.fetch,valid={...reviewFixture()[0],jobRequirement:""};let calls=0;
  globalThis.fetch=mockVerifiedReview(async(_input,options)=>{calls++;const body=JSON.parse(String(options?.body));if(calls===2)assert.match(body.messages[0].content,/unsupported number/);return completion({suggestions:[calls===1?{...valid,suggested:valid.suggested+" Increased revenue by 47%."}:valid],comments:[],insights:[]});});
  try{const response=await analyzeRequest(reviewRequest());const data=await endpointResult(response);assert.equal(response.status,200);assert.equal(data.suggestions?.length,1);assert.equal(data.suggestions?.[0]?.suggested,valid.suggested);assert.equal(calls,2);}
  finally{globalThis.fetch=originalFetch;}
});

test("a repair cannot convert unsupported claims into accepted edits",async()=>{
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return completion({suggestions:[{...reviewFixture()[0],jobRequirement:"",suggested:"Delivered a 47% increase in revenue."}],comments:[],insights:[]});};
  try{const response=await analyzeRequest(reviewRequest());const data=await endpointResult(response);assert.equal(response.status,502);assert.equal(data.code,"GROQ_UNVERIFIED_REVIEW");assert.equal(data.suggestions,undefined);assert.equal(data.comments,undefined);assert.equal(calls,2);}
  finally{globalThis.fetch=originalFetch;}
});

test("truncated and malformed completions get at most one bounded repair",async()=>{
  const originalFetch=globalThis.fetch;
  try{for(const first of [()=>completion({},"length"),()=>Response.json({choices:[{message:{content:"{invalid"}}]})]){
    let calls=0,initialBudget=0;globalThis.fetch=async(_input,options)=>{calls++;const body=JSON.parse(String(options?.body));if(calls===1)initialBudget=body.max_completion_tokens;else{assert.ok(body.max_completion_tokens>initialBudget);assert.match(body.messages[0].content,/at most 2 short edits/);}return calls===1?first():completion({suggestions:[],comments:[aiComment],insights:[]});};
    const response=await analyzeRequest(reviewRequest());assert.equal(response.status,200);assert.equal((await endpointResult(response)).comments?.[0]?.origin,"ai");assert.equal(calls,2);
  }
    let calls=0;globalThis.fetch=async()=>{calls++;return completion({},"length");};const response=await analyzeRequest(reviewRequest());assert.equal(response.status,502);assert.equal((await endpointResult(response)).code,"GROQ_OUTPUT_TRUNCATED");assert.equal(calls,2);
  }finally{globalThis.fetch=originalFetch;}
});

test("a revision repairs only its pending block and never changes the original CV",async()=>{
  const originalFetch=globalThis.fetch,blocks=parseCV(SAMPLE_CV),suggestion={...reviewFixture()[0],jobRequirement:""};const before=structuredClone(blocks);let calls=0;
  globalThis.fetch=mockVerifiedReview(async()=>{calls++;return completion({suggestions:[{...suggestion,blockId:calls===1?"wrong-block":suggestion.blockId}],comments:[],insights:[]});});
  try{const response=await analyzeRequest(reviewRequest({blocks,revision:{suggestion,comment:"Make the contribution clearer."}}));const data=await endpointResult(response);assert.equal(response.status,200);assert.equal(data.suggestions?.length,1);assert.equal(data.suggestions?.[0]?.blockId,suggestion.blockId);assert.equal(data.suggestions?.[0]?.status,"pending");assert.deepEqual(blocks,before);assert.equal(calls,2);}
  finally{globalThis.fetch=originalFetch;}
});

test("semantic verification rejects invented business impact, notebook baselines and employer divisions",async()=>{
  const originalFetch=globalThis.fetch,valid=reviewFixture()[0];let calls=0;
  const invented=[
    {...valid,blockId:"impact",suggested:"Analyzed data to identify retention drivers and inform roadmap decisions."},
    {...valid,blockId:"baseline",original:"Compared model performance and documented experiment results.",suggested:"Compared against logistic regression in a reproducible Jupyter notebook."},
    {...valid,blockId:"division",original:"Data Science Intern · Northstar Analytics",suggested:"Data Science Intern · Northstar Analytics – Healthcare Analytics Division"},
  ];
  globalThis.fetch=async(_input,options)=>{calls++;const body=JSON.parse(String(options?.body));const context=JSON.parse(body.messages[1].content);assert.equal(context.proposals.length,4);assert.equal(context.jobDescription,undefined);assert.equal(context.companySources,undefined);assert.ok(context.proposals.every((p:{evidence:unknown[]})=>Array.isArray(p.evidence)));
    return completion({checks:[{blockId:valid.blockId,supported:true,reason:"Preserves the documented Python and SQL analysis contribution."},...invented.map(e=>({blockId:e.blockId,supported:false,reason:"This detail is not documented in the cited source. What evidence confirms it?"}))]});
  };
  try{const result=await verifyReviewEdits(testKey,[valid,...invented]);assert.deepEqual(result.suggestions,[valid]);assert.equal(result.comments.length,3);assert.ok(result.comments.every(c=>c.origin==="ai"));assert.equal(calls,1);}
  finally{globalThis.fetch=originalFetch;}
});

test("missing or duplicate verification decisions never approve an edit",async()=>{
  const originalFetch=globalThis.fetch,edit=reviewFixture()[0];
  try{for(const checks of [[],[{blockId:edit.blockId,supported:true,reason:"Documented facts were preserved."},{blockId:edit.blockId,supported:true,reason:"Documented facts were preserved."}]]){
    globalThis.fetch=async()=>completion({checks});const result=await verifyReviewEdits(testKey,[edit]);assert.deepEqual(result.suggestions,[]);assert.equal(result.comments.length,1);
  }
    globalThis.fetch=async()=>completion({suggestions:[]});await assert.rejects(()=>verifyReviewEdits(testKey,[edit]),/could not verify/);
  }finally{globalThis.fetch=originalFetch;}
});

test("the server uses its saved key without revealing it in configuration or connection responses",async()=>{
  const originalFetch=globalThis.fetch,previous=process.env.GROQ_API_KEY;let calls=0;process.env.GROQ_API_KEY=testKey;
  globalThis.fetch=async(_input,options)=>{calls++;assert.equal((options?.headers as Record<string,string>).Authorization,`Bearer ${testKey}`);const body=JSON.parse(String(options?.body));return completion(JSON.parse(body.messages[1].content));};
  try{
    const config=await savedConnectionStatus().json();assert.deepEqual(config,{configured:true});assert.ok(!JSON.stringify(config).includes(testKey));
    const response=await connectionRequest(new Request("https://cv.example/api/ai-status",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));const data=await endpointResult(response);assert.equal(response.status,200);assert.equal(data.connected,true);assert.ok(!JSON.stringify(data).includes(testKey));assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch;if(previous===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=previous;}
});

test("no saved key produces a clear unconfigured error without a provider call",async()=>{
  const originalFetch=globalThis.fetch,previous=process.env.GROQ_API_KEY;let calls=0;delete process.env.GROQ_API_KEY;globalThis.fetch=async()=>{calls++;throw Error("must not call");};
  try{assert.deepEqual(await savedConnectionStatus().json(),{configured:false});const response=await analyzeRequest(reviewRequest({key:undefined}));assert.equal(response.status,400);assert.equal((await endpointResult(response)).code,"GROQ_NOT_CONFIGURED");assert.equal(calls,0);}
  finally{globalThis.fetch=originalFetch;if(previous!==undefined)process.env.GROQ_API_KEY=previous;}
});

test("formatted CVs never silently use a rebuilt export layout",()=>{
  assert.deepEqual(layoutSafeExports("docx",true),{docx:true,pdf:false});
  assert.deepEqual(layoutSafeExports("docx",false),{docx:true,pdf:false});
  assert.deepEqual(layoutSafeExports("pdf",true),{docx:false,pdf:true});
  assert.deepEqual(layoutSafeExports("pdf",false),{docx:false,pdf:false});
  assert.deepEqual(layoutSafeExports(null,false),{docx:true,pdf:true});
  const original=[{id:"one",text:"Original sentence"}];
  assert.ok(sameDocumentContent(original,[{...original[0]}]));
  assert.ok(!sameDocumentContent(original,[{id:"one",text:"Edited sentence"}]));
  assert.ok(!sameDocumentContent(original,[{id:"two",text:"Original sentence"}]));
});
