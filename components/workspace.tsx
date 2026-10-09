"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, BriefcaseBusiness, Layers, Check, X, MessageSquare, Download, Settings2, GitFork as Github, Sparkles, Undo2, Plus, BookOpen, LoaderCircle, Link2, Pencil, ChevronRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Toaster, toast } from "sonner";
import { applyDecision, cvSources, keywordReport, localAnalysis, parseCV, isEntryLine, isMeaningfulEdit, SAMPLE_CV, SAMPLE_EVIDENCE, SAMPLE_JOB, type Block, type Evidence, type Suggestion, type Analysis, type CompanyResearch, type CompanyInsight, type ReviewComment, descriptionError, isURLOnly } from "@/lib/cv";
import { readCVDocument, readEvidence, saveBlob } from "@/lib/import";

import {defaultCVStyle,blockStyle,cssFont,type CVStyle} from "@/lib/cv-style";
import {sameDocumentContent,layoutSafeExports} from "@/lib/document-preservation";
import InlineCVReview from "@/components/inline-cv-review";

const errorText = (e: unknown) => e instanceof Error ? e.message : "Something went wrong. Please try again.";
type UploadedCV = {bytes:ArrayBuffer;format:string;blocks:Block[]};
type ModelContext = { registerTool: (tool: {name: string; title: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => unknown}, options: {signal: AbortSignal}) => void | Promise<void> };

export default function Workspace() {
  const [cvStyle,setCVStyle]=useState<CVStyle>(defaultCVStyle);
  const originalFile=useRef<UploadedCV|null>(null);
  const [pdfPreviewURL,setPdfPreviewURL]=useState<string|null>(null);
  const pdfObjectURL=useRef<string|null>(null);
  useEffect(()=>()=>{if(pdfObjectURL.current)URL.revokeObjectURL(pdfObjectURL.current);},[]);
  const [analysisError,setAnalysisError]=useState("");
  const [comments,setComments]=useState<ReviewComment[]>([]);
  const [jobError,setJobError]=useState("");
  const [tab, setTab] = useState("sources");
  const [cvText, setCVText] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]), [original, setOriginal] = useState<Block[]>([]);
  const [job, setJob] = useState(""), [jobURL, setJobURL] = useState(""), [githubURL, setGithubURL] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [companyURL,setCompanyURLState]=useState(""),[research,setResearch]=useState<CompanyResearch|null>(null),[insights,setInsights]=useState<CompanyInsight[]>([]);
  const startupConnection=useRef<AbortController|null>(null);
  const [savedKey,setSavedKey]=useState(false);
  const [keyVerified,setKeyVerified]=useState(false),[connectionError,setConnectionError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();startupConnection.current=controller;
    void (async()=>{
      try{
        const status=await fetch("/api/ai-status",{signal:controller.signal});
        const config=await status.json() as {configured?:boolean};
        if(!status.ok||!config.configured||controller.signal.aborted)return;
        setSavedKey(true);
        const response=await fetch("/api/ai-status",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",signal:controller.signal});
        const result=await response.json() as {connected?:boolean;error?:string};
        if(controller.signal.aborted)return;
        if(response.ok&&result.connected)setKeyVerified(true);
        else setConnectionError(result.error||"The saved AI connection could not be verified.");
      }catch{/* Manual connection remains available when the startup test cannot finish. */}
    })();
    return ()=>controller.abort();
  },[]);
  function setCompanyURL(value:string){setCompanyURLState(value);setResearch(null);setInsights([]);}
  async function loadCompany(url:string){
    if(!url.trim())return null;setBusy("Reading company sources");
    try {const res=await fetch("/api/research",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})});const data=await res.json() as CompanyResearch&{error?:string};if(!res.ok)throw new Error(data.error||"Company research failed.");setResearch(data);setInsights([]);toast.success(`${data.sources.length} company pages read${data.failures.length?`; ${data.failures.length} unavailable`:""}.`);return data;}
    catch(e){toast.error(errorText(e));return null;}finally{setBusy("");}
  }
  async function verifyKey(){
    startupConnection.current?.abort();setBusy("Checking AI connection");setConnectionError("");
    try {const res=await fetch("/api/ai-status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key})});const data=await res.json() as {error?:string;connected?:boolean};if(!res.ok||!data.connected)throw new Error(data.error||"The AI connection could not be verified.");setKeyVerified(true);setSettings(false);setAnalysisError("");toast.success("AI generation tested. Your connection is ready.");}
    catch(e){setKeyVerified(false);setConnectionError(errorText(e));}finally{setBusy("");}
  }
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]), [analysisMode, setAnalysisMode] = useState<"local" | "groq" | null>(null);
  const [busy, setBusy] = useState(""), [settings, setSettings] = useState(false), [key, setKey] = useState("");
  const [fileName, setFileName] = useState(""), [sample, setSample] = useState(false), [showRaw, setShowRaw] = useState(false);
  const [filter, setFilter] = useState("pending");
  const cvInput = useRef<HTMLInputElement>(null), evidenceInput = useRef<HTMLInputElement>(null);
  const current = useRef({ blocks, original, evidence, job, suggestions }); current.current = { blocks, original, evidence, job, suggestions };
  const report = keywordReport(blocks, job, evidence), accepted = suggestions.filter(s => s.status === "accepted").length, pending = suggestions.filter(s => s.status === "pending").length;
  const sources = cvSources(original.length ? original : blocks, evidence);
  const uploaded=originalFile.current;
  const uploadedUnchanged=!uploaded||sameDocumentContent(uploaded.blocks,blocks);
  const {docx:allowStyledDOCX,pdf:allowStyledPDF}=layoutSafeExports(uploaded?.format||null,uploadedUnchanged);

  function setCV(text: string, name = "Pasted CV") {
    setCVStyle(defaultCVStyle());originalFile.current=null;
    if(pdfObjectURL.current){URL.revokeObjectURL(pdfObjectURL.current);pdfObjectURL.current=null;}
    setPdfPreviewURL(null);
    const parsed = parseCV(text); setCVText(text); setBlocks(parsed); setOriginal(parsed); setFileName(name);
    setSuggestions([]);setComments([]);setAnalysisError(""); setAnalysisMode(null); setInsights([]); setSample(false);
  }
  function decide(id: string, status: "accepted" | "rejected" | "pending") {
    const state = current.current;
    const result = applyDecision(state.blocks, state.suggestions, id, status);
    current.current = {...state, ...result};
    setBlocks(result.blocks); setCVText(result.blocks.map(b => b.text).join("\n")); setSuggestions(result.suggestions);
    return { id, status, text: result.blocks.find(b => b.id === state.suggestions.find(s => s.id === id)?.blockId)?.text };
  }
  useEffect(() => {
    const context = (document as Document & {modelContext?: ModelContext}).modelContext; if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    for (const tool of [
      { name: "read_cv_review", title: "Read CV review", description: "Read the current CV, source-linked suggestions and their review decisions. Contains personal user data.", inputSchema: {type: "object", properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true, untrustedContentHint: true}, execute: () => ({cv: current.current.blocks, suggestions: current.current.suggestions}) },
      { name: "review_cv_suggestion", title: "Review a CV suggestion", description: "Accept, reject or undo a specific CV suggestion. Accept changes the CV text; undo restores the original text. Only use a decision explicitly requested by the user.", inputSchema: {type: "object", properties: {id: {type: "string"}, decision: {type: "string", enum: ["accepted", "rejected", "pending"]}}, required: ["id", "decision"], additionalProperties: false}, annotations: {readOnlyHint: false, untrustedContentHint: true}, execute: (input: unknown) => {
        const value = input as {id?: unknown; decision?: unknown};
        if (!value || typeof value.id !== "string" || !["accepted", "rejected", "pending"].includes(String(value.decision))) throw new Error("Provide a valid suggestion ID and decision.");
        return decide(value.id, value.decision as "accepted" | "rejected" | "pending");
      } },
    ]) void Promise.resolve(context.registerTool(tool, {signal: lifecycle.signal})).catch(() => {});
    return () => lifecycle.abort();
  }, []);

  async function uploadCV(file?: File) {
    if (!file) return; setBusy("Reading your CV");
    try {const document=await readCVDocument(file);setCV(document.text,file.name);setCVStyle(document.style);originalFile.current=document.bytes?{bytes:document.bytes,format:document.format,blocks:parseCV(document.text)}:null;
      if(document.bytes&&document.format==="pdf"){const url=URL.createObjectURL(new Blob([document.bytes],{type:"application/pdf"}));pdfObjectURL.current=url;setPdfPreviewURL(url);}
      setShowRaw(false);toast.success("CV imported. Its original file will be kept for preview and supported exports.");}
    catch (e) {toast.error(errorText(e));} finally {setBusy(""); if (cvInput.current) cvInput.current.value = "";}
  }
  async function uploadEvidence(files: File[]) {
    if (!files.length) return; setBusy("Reading project evidence");
    try {
      const collected: Evidence[] = []; let skipped = 0;
      for (const file of files.slice(0, 5)) {const result = await readEvidence(file); collected.push(...result.sources); skipped += result.skipped;}
      if ([...evidence, ...collected].reduce((n,e) => n + e.text.length, 0) > 25000 || evidence.length + collected.length > 12) throw new Error("Limit evidence to 12 sources and 25,000 characters. Remove a source or use shorter project summaries.");
      setEvidence(prev => [...prev, ...collected]); setSuggestions([]); setAnalysisMode(null);
      toast.success(`${collected.length} sources added${skipped ? `; ${skipped} files skipped` : ""}.`);
    } catch(e) {toast.error(errorText(e));} finally {setBusy(""); if(evidenceInput.current) evidenceInput.current.value = "";}
  }
  async function importLink(kind: "job" | "github") {
    setBusy(kind === "job" ? "Reading the job description" : "Reading public project READMEs");
    try {
      const res = await fetch(`/api/import`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,url:kind === "job" ? jobURL : githubURL})});
      const data = await res.json() as {error?:string;text:string;sources:Evidence[];companyURL?:string}; if(!res.ok) throw new Error(data.error || "Could not read the link.");
      if(kind === "job") {setJob(data.text);setJobError("");setComments([]);setCompanyURLState(data.companyURL||"");setResearch(null);setInsights([]);toast.success("Job imported. Check the extracted description.");if(data.companyURL)await loadCompany(data.companyURL);}
      else {
        const combined = [...evidence, ...data.sources] as Evidence[];
        if(combined.length > 12 || combined.reduce((n,e)=>n+e.text.length,0)>25000) throw new Error("Evidence limit reached. Remove a source first.");
        setEvidence(combined); setGithubURL(""); toast.success(`${data.sources.length} README sources added.`);
      }
      setSuggestions([]); setAnalysisMode(null);
    } catch(e) {toast.error(errorText(e));} finally {setBusy("");}
  }
  function runChecks(){
    if(!validateInputs())return;
    setAnalysisError("");const result=localAnalysis(blocks,job,evidence);setComments(result.comments||[]);setAnalysisMode(suggestions.length?"groq":result.mode);setTab("review");setFilter("pending");toast.info("Review checks completed. Comments are marked as non-AI checks.");
  }
  async function analyze() {
    if(isURLOnly(job)){rejectDescription();return;}
    if((!key&&!savedKey)||!keyVerified){setSettings(true);return;}
    if(!validateInputs())return;
    try {
      let company=research;
      if(companyURL&&!company)company=await loadCompany(companyURL);
      setAnalysisError("");setBusy("Reviewing your CV");
      const res=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({blocks,job,evidence,key,research:company?.sources||[],history:suggestions.map(({blockId,original,suggested,status})=>({blockId,original,suggested,status}))})});
      const data=await res.json() as Analysis&{error?:string;code?:string};if(!res.ok){if(data.code==="GROQ_AUTH"||data.code==="GROQ_MODEL_ACCESS"){setKeyVerified(false);setConnectionError(data.error||"Reconnect AI.");}throw new Error(data.error||"AI analysis failed.");}
      if(!suggestions.length)setOriginal(blocks);
      setSuggestions(prev=>[...prev,...data.suggestions.map(s=>({...s,id:crypto.randomUUID()}))]);setComments(data.comments||[]);setInsights(data.insights||[]);setAnalysisMode("groq");setTab("review");setFilter("pending");
      toast.success(`${data.suggestions.length} suggestions · ${data.comments?.length||0} review comments.`);
    }catch(e){const message=errorText(e);toast.error(message);setAnalysisError(message);}finally{setBusy("");}
  }
  async function revise(id: string, comment: string) {
    if((!key&&!savedKey)||!keyVerified) {toast.info("Add a Groq key in AI settings for comment-based revisions. You can also edit the proposed wording yourself."); return;}
    if(!comment.trim()) {toast.error("Add a comment explaining what to change."); return;}
    const suggestion = suggestions.find(s=>s.id===id); if(!suggestion || suggestion.status !== "pending") return;
    setBusy(`Revising ${id}`);
    try {
      const res = await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({blocks:blocks.map(b=>b.id===suggestion.blockId?{...b,text:suggestion.original}:b),job,evidence,key,research:research?.sources||[],revision:{suggestion,comment}})});
      const data = await res.json() as Analysis & {error?:string}; if(!res.ok) throw new Error(data.error || "Revision failed.");
      if(!data.suggestions?.length){setComments(data.comments||[]);toast.info("The review explains what information is needed for this revision.");return;}
      setSuggestions(prev=>prev.map(s=>s.id===id ? {...data.suggestions[0],id,status:"pending",comment} : s)); toast.success("Suggestion revised. Your CV is unchanged until you accept it.");
    } catch(e) {toast.error(errorText(e));} finally {setBusy("");}
  }
  async function exportDOCX() {
    if(originalFile.current?.format==="pdf"){toast.error("For format-preserving edits, upload the original DOCX. A PDF cannot be safely converted into an identical editable Word file.");return;}
    setBusy("Preparing DOCX");
    try {
      const {Document, Paragraph, TextRun, Packer, HeadingLevel} = await import("docx");
      if(originalFile.current?.format==="docx"){const {patchDOCX}=await import("@/lib/export");saveBlob(await patchDOCX(originalFile.current.bytes,originalFile.current.blocks,blocks),"tailored-cv.docx");toast.success("DOCX downloaded with the original formatting.");return;}
      const doc = new Document({styles:{default:{document:{run:{font:cvStyle.body.fontName,size:Math.round(cvStyle.body.size*2)},paragraph:{spacing:{after:100}}}}},sections:[{properties:{page:{margin:{top:850,bottom:850,left:1000,right:1000}}},children:blocks.map((b,i)=>new Paragraph({heading:i===0?HeadingLevel.TITLE:b.heading?HeadingLevel.HEADING_2:undefined,children:[new TextRun({text:b.text,color:blockStyle(b,i,cvStyle).color,bold:blockStyle(b,i,cvStyle).bold,font:blockStyle(b,i,cvStyle).fontName,size:Math.round(blockStyle(b,i,cvStyle).size*2)})],spacing:{before:b.heading?220:0,after:100}}))}]});
      saveBlob(await Packer.toBlob(doc), "tailored-cv.docx"); toast.success("DOCX downloaded.");
    } catch(e) {toast.error(errorText(e));} finally {setBusy("");}
  }
  async function downloadPDF(){
    if(originalFile.current&&(originalFile.current.format!=="pdf"||!sameDocumentContent(originalFile.current.blocks,blocks))){toast.error("Exact-layout PDF export is only available for an unchanged source PDF. For approved edits, export the source DOCX through Word.");return;}
    setBusy("Preparing PDF");try{const file=originalFile.current,unchanged=file&&file.format==="pdf"&&sameDocumentContent(file.blocks,blocks);if(unchanged){saveBlob(new Blob([file.bytes],{type:"application/pdf"}),"tailored-cv.pdf");}else{const {exportPDF}=await import("@/lib/export");saveBlob(new Blob([new Uint8Array(await exportPDF(blocks,cvStyle)).buffer],{type:"application/pdf"}),"tailored-cv.pdf");}toast.success("PDF downloaded without browser headers or footers.");}catch(e){toast.error(errorText(e));}finally{setBusy("");}
  }
  function rejectDescription(){const message=descriptionError(job)||"You pasted the wrong thing: put the URL into Job link and press Read link.";setJobError(message);toast.error(message,{position:"top-right",id:"wrong-description"});}
  function validateInputs(){const error=descriptionError(job);if(error){setJobError(error);toast.error(error,{position:"top-right",id:"wrong-description"});return false;}if(!blocks.length){toast.error("Add your CV first.");return false;}return true;}
  function loadSample() {setCV(SAMPLE_CV,"Sample CV · Avery Chen");setJob(SAMPLE_JOB);setEvidence(SAMPLE_EVIDENCE);setSample(true);toast.info("Fictional sample loaded. No personal data or API calls.");}
  function safeDecision(id: string, status: "accepted" | "rejected" | "pending") {try {decide(id,status);} catch(e) {toast.error(errorText(e));}}

  return <>
    <Toaster position="top-right" richColors />
    <header className="topbar">
      <a href="/" className="brand"><span className="brand-icon"><FileText size={22}/></span><span>CV<span className="brand-light"> Agent</span></span><span className="beta">BETA</span></a>
      <div className="header-actions"><button className="button secondary small" disabled={!!busy} onClick={()=>setSettings(true)}><Settings2 size={16}/><span>AI settings</span></button><a className="icon-button" href="https://github.com/lamanmamed/cv-agent" target="_blank" rel="noreferrer" aria-label="View source on GitHub"><Github size={20}/></a></div>
    </header>
    <main className="workspace">
      <div className="page-heading"><div><h1>CV editor</h1></div><button className="button secondary" onClick={loadSample} disabled={!!busy || !!blocks.length}><BookOpen size={17}/> Try a sample</button></div>
      {analysisError&&<div className="connection-error" role="alert"><p>AI review failed: {analysisError}</p><button className="button secondary small" disabled={!!busy} onClick={analyze}>{keyVerified?"Retry AI review":"Reconnect AI"}</button></div>}
      <Tabs value={tab} onValueChange={setTab} className="workspace-tabs">
        <div className="workflow-bar"><TabsList className="steps" variant="line"><TabsTrigger value="sources"><span className="step-number">1</span> Add your sources</TabsTrigger><TabsTrigger value="review" disabled={!analysisMode}><span className="step-number">2</span> Review changes{pending>0&&<span className="count">{pending}</span>}</TabsTrigger><TabsTrigger value="export" disabled={!blocks.length}><span className="step-number">3</span> Export CV</TabsTrigger></TabsList><span className="mode-label">{keyVerified ? "AI ready · Groq" : "AI not connected"}</span></div>
        <TabsContent value="sources">
          {!keyVerified&&<div className="ai-notice"><div><strong>AI is not connected</strong>Connect a Groq API key for tailored suggestions. Review checks work without AI.</div><button className="button secondary small" disabled={!!busy} onClick={()=>setSettings(true)}>Connect AI</button></div>}
          <div className="sources-grid">
            <section className="panel cv-panel">
              <div className="panel-title"><span className="section-icon"><FileText size={19}/></span><div><h2>Your CV</h2><p>Upload a file or paste text.</p></div>{fileName&&<span className="pill">{sample?"Sample":"Imported"}</span>}</div>
              <input type="file" ref={cvInput} accept=".pdf,.docx,.txt,.md" hidden onChange={e=>uploadCV(e.target.files?.[0])}/>
              <button className={`upload-zone ${blocks.length ? "has-file" : ""}`} disabled={!!busy} onClick={()=>cvInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void uploadCV(e.dataTransfer.files[0]);}}>
                <span className="upload-icon">{blocks.length?<FileText size={25}/>:<Upload size={25}/>}</span><strong>{fileName || "Drop your CV here"}</strong><span>{blocks.length ? "Click to replace your CV" : "or click to choose a file"}</span><small>PDF, DOCX, TXT · up to 10 MB</small>
              </button>
              <div className="split-label"><span>{blocks.length?`${blocks.length} text lines extracted`:"Prefer to paste it?"}</span><button className="text-button" disabled={!!busy} onClick={()=>setShowRaw(!showRaw)}>{showRaw?"Hide text":blocks.length?"Check extracted text":"Paste CV text"}</button></div>
              {showRaw&&<label className="field"><span>CV text</span>{originalFile.current&&<small className="small-note">Changing extracted text here detaches the original file. Use review suggestions to preserve Word formatting.</small>}<textarea className="cv-text-input" value={cvText} maxLength={25000} disabled={!!busy} onChange={e=>{const importedStyle=cvStyle;setCV(e.target.value,fileName);setCVStyle({...importedStyle,blocks:{}});}} placeholder="Paste your CV, including section headings…" /></label>}
              {blocks.length>0&&!showRaw&&!originalFile.current&&<div className="mini-preview"><p className="preview-label">TEXT PREVIEW</p>{blocks.slice(0,5).map(b=><p className={b.heading?"mini-heading":""} key={b.id}>{b.text}</p>)}{blocks.length>5&&<span className="muted">+ {blocks.length-5} more lines</span>}</div>}
              <div className="source-note"><p>Files are read in your browser. They aren’t stored on our server. AI mode sends extracted text to Groq when you request an analysis.</p></div>
            </section>
            <div className="context-column">
              <section className="panel job-panel"><div className="panel-title"><span className="section-icon blue"><BriefcaseBusiness size={19}/></span><div><h2>Job and company</h2><p>Read the job link first, then check the extracted text.</p></div></div>
                <label className="field"><span>Job link</span><div className="input-action"><Link2 size={16}/><input type="url" value={jobURL} disabled={!!busy} onChange={e=>setJobURL(e.target.value)} placeholder="https://company.com/careers/role"/><button className="button secondary small" disabled={!!busy||!jobURL} onClick={()=>importLink("job")}>Read link</button></div></label>
                <p className="small-note reader-note">Public HTTPS pages are supported. Some websites require a login or block automated reading.</p>
                <label className="field"><span>Job description <span className="optional">paste or edit</span></span><textarea value={job} disabled={!!busy} maxLength={15000} onChange={e=>{setJob(e.target.value);setJobError(isURLOnly(e.target.value)?"You pasted the wrong thing: put the URL into Job link and press Read link.":"");setComments([]);setAnalysisMode(null);}} onBlur={()=>{if(isURLOnly(job))rejectDescription();}} placeholder="The extracted description will appear here. You can also paste it directly." aria-invalid={!!jobError} aria-describedby={jobError?"job-description-error":undefined} onPaste={e=>{const text=e.clipboardData.getData("text");if(isURLOnly(text)){e.preventDefault();setJobError("You pasted the wrong thing: put the URL into Job link and press Read link.");toast.error("You pasted the wrong thing: put the URL into Job link and press Read link.",{position:"top-right",id:"wrong-description"});}}} className="job-input" />{jobError&&<span id="job-description-error" role="alert" className="field-error">{jobError}</span>}</label>
                <CompanySources companyURL={companyURL} setCompanyURL={setCompanyURL} research={research} disabled={!!busy} onResearch={()=>loadCompany(companyURL)}/>
              </section>
              <section className="panel evidence-panel"><div className="panel-title"><span className="section-icon purple"><Layers size={19}/></span><div><h2>Project evidence</h2><p>GitHub READMEs, project files, and documents.</p></div><span className="optional">OPTIONAL</span></div>
                <label className="field"><span>Public GitHub repository or profile</span><div className="input-action"><Github size={17}/><input type="url" value={githubURL} disabled={!!busy} onChange={e=>setGithubURL(e.target.value)} placeholder="https://github.com/you/project"/><button className="button secondary small" disabled={!!busy||!githubURL} onClick={()=>importLink("github")}>Add</button></div></label>
                <input ref={evidenceInput} hidden type="file" multiple accept=".zip,.md,.txt,.pdf,.docx" onChange={e=>uploadEvidence(Array.from(e.target.files||[]))}/>
                <button className="evidence-upload" disabled={!!busy} onClick={()=>evidenceInput.current?.click()}><Plus size={18}/> Add a project ZIP, README, or document<span>10 MB max</span></button>
                {evidence.length>0&&<div className="source-list">{evidence.map(e=><div key={e.id}><FileText size={15}/><span title={e.name}>{e.name}</span><button className="icon-button" disabled={!!busy} aria-label={`Remove ${e.name}`} onClick={()=>{setEvidence(prev=>prev.filter(s=>s.id!==e.id));setAnalysisMode(null);setSuggestions([]);}}><X size={14}/></button></div>)}</div>}
                <p className="small-note">We read selected text files only. Uploaded code is never executed. GitHub imports read public READMEs.</p>
              </section>
            </div>
          </div>
          <div className="analyze-bar"><div><p><strong>{keyVerified?"AI analysis":"AI connection required"}</strong><span>{keyVerified?"Uses the job, project evidence, and available company sources.":"Connect a free-plan Groq key to generate tailored edits."}</span></p></div><div className="analyze-options"><button className="text-button" disabled={!!busy||!blocks.length||job.trim().length<40} onClick={runChecks}>Review checks</button><button className="button primary analyze-button" onClick={analyze} disabled={!!busy||(keyVerified&&(!blocks.length||job.trim().length<40))}>{busy?<LoaderCircle className="spin" size={19}/>:<Sparkles size={19}/>} {busy||(keyVerified?"Review CV":"Connect AI")}</button></div></div>
        </TabsContent>
        <TabsContent value="review">
          <div className="review-summary">
            <div><h2>Review changes in your CV</h2><p>Select highlighted text to compare the original and suggested wording in context. Approve, reject, edit or ask Groq for another version; your source file is never silently restyled.</p></div>
            <span className="review-count"><strong>{accepted}</strong> / {suggestions.length} accepted</span>
          </div>
          <InlineCVReview source={uploaded} fileName={fileName} blocks={blocks} suggestions={suggestions} disabled={!!busy} onDecision={(id,status)=>safeDecision(id,status)} onRevise={(id,instruction)=>revise(id,instruction)} onEdit={(id,text)=>setSuggestions(prev=>prev.map(item=>item.id===id?{...item,suggested:text,reason:"Wording edited by you. Confirm the claims before accepting."}:item))}/>
          {analysisError&&<p className="connection-error" role="alert">{analysisError}</p>}
          {(comments.length>0||report.requirements.length>0)&&<details className="editor-additional-feedback">
            <summary>Additional review context · {comments.length} observations · {report.matched.length}/{report.requirements.length} job terms mentioned</summary>
            {comments.length>0&&<div className="review-comments">{comments.map(c=><article className="review-comment" key={c.id}><div><MessageSquare size={16}/><strong>{c.kind==="question"?"Clarification needed":c.kind==="strength"?"Strength":"Observation"}</strong><span>{c.origin==="ai"?"AI review":"Review check"}</span></div>{c.blockId&&<blockquote>{blocks.find(b=>b.id===c.blockId)?.text}</blockquote>}<p>{c.text}</p></article>)}</div>}
            {report.requirements.length>0&&<div className="keyword-panel"><div className="keyword-title"><h3>Job keyword coverage</h3><span>{report.matched.length} / {report.requirements.length} found in CV</span></div><div className="keyword-tags">{report.matched.map(s=><span className="keyword matched" key={s}><Check size={12}/>{s}</span>)}{report.evidenceOnly.map(s=><span className="keyword evidence" key={s}>{s} · in evidence</span>)}{report.missing.map(s=><span className="keyword missing" key={s}>{s} · gap</span>)}</div><p>Technical term scan, not an ATS score. Evidence-only terms need your confirmation.</p></div>}
          </details>}
          {suggestions.length>0&&pending===0&&<div className="editor-done"><Check size={17}/> All decisions reviewed. <button className="text-button" onClick={()=>setTab("export")}>Continue to export <ChevronRight size={15}/></button></div>}
        </TabsContent>
        <TabsContent value="export">
          <div className="export-grid"><section><h2 className="export-heading">Export CV</h2><p className="export-copy">Download approved wording without silently replacing your uploaded document’s design. Suggestions and comments stay outside the document.</p><div className="export-status"><Check size={18}/>{accepted} changes accepted{pending>0&&<span> · {pending} still pending</span>}</div>
            <div className="export-actions">{allowStyledDOCX&&<button className="button primary" onClick={exportDOCX} disabled={!!busy}><Download size={18}/> Download DOCX</button>}{allowStyledPDF&&<button className="button secondary" onClick={downloadPDF} disabled={!!busy}><FileText size={18}/> Download PDF</button>}<button className="text-button" onClick={()=>saveBlob(new Blob([blocks.map(b=>b.text).join("\n")],{type:"text/plain;charset=utf-8"}),"tailored-cv.txt")}><Download size={16}/> Download plain text</button></div>
            <div className="export-note"><h3>Layout preservation</h3><p>{uploaded?.format==="pdf"?(uploadedUnchanged?"Download the exact original PDF.":"An edited PDF cannot reliably retain its original fonts, spacing, columns and page layout. Download the approved wording as text, or upload the original DOCX to apply changes while retaining its styles. The original PDF remains untouched."):uploaded?.format==="docx"?"The DOCX download patches the original Word file rather than recreating it. To get a PDF with the same layout, open the downloaded DOCX in Word or Google Docs and export it as PDF.":"No original designed file was uploaded. New DOCX and PDF files use a neutral layout."}</p></div>
            <button className="text-button" onClick={()=>saveBlob(new Blob([JSON.stringify({version:3,cv:blocks,original,suggestions,comments,evidence,job,research,insights,cvStyle},null,2)],{type:"application/json"}),"cv-agent-review.json")}><Download size={16}/> Save review history</button><p className="small-note">This session is temporary. Download your work before closing the tab. Review history contains your CV, job text, and evidence.</p>
          </section><section className="document-panel"><OriginalDocumentPreview source={uploaded} pdfURL={pdfPreviewURL} fileName={fileName} blocks={blocks} suggestions={[]} style={cvStyle}/></section></div>
        </TabsContent>
      </Tabs>
      <footer className="footer"><span>CV Agent</span><p>Job alignment and formatting guidance. No universal ATS score or guaranteed outcome.</p><a href="https://github.com/lamanmamed/cv-agent" target="_blank" rel="noreferrer">Source code <Github size={14}/></a></footer>
    </main>
    {!uploaded&&<div className="print-only"><CVDocument blocks={blocks} suggestions={[]} style={cvStyle}/></div>}
    <Dialog open={settings} onOpenChange={setSettings}><DialogContent className="settings-dialog"><DialogTitle>Connect AI</DialogTitle><DialogDescription>AI tailoring uses Groq. Create a free-plan account, generate an API key, and connect it here.</DialogDescription>{savedKey&&<p className="small-note">A key is saved securely for this private app. Test it below, or enter another key for this session.</p>}<label className="field"><span>Groq API key</span><input type="password" autoComplete="off" disabled={!!busy} value={key} onChange={e=>{startupConnection.current?.abort();setKey(e.target.value.trim());setKeyVerified(false);setConnectionError("");}} placeholder="gsk_…"/></label><p className="small-note">Testing runs a small AI generation request using fictional data and the review format; it uses your Groq quota. During AI analysis, CV and project text is sent to Groq. A key entered here stays in this tab’s memory. A saved key is used by the server and is never sent to your browser.</p><p className="small-note">Job and company URLs are read through Jina Reader. CV files are not sent to that reader. Keep your Groq account on the free plan if you want to avoid paid inference.</p>{connectionError&&<p role="alert" className="connection-error">{connectionError}</p>}<a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-button">Create a Groq key</a><div className="dialog-actions"><button className="button secondary" disabled={!!busy} onClick={()=>{startupConnection.current?.abort();setKey("");setKeyVerified(false);setSettings(false);}}>Disconnect</button><button className="button primary" disabled={!!busy||(key.length<10&&!savedKey)} onClick={verifyKey}>{busy?"Testing…":"Test and connect"}</button></div></DialogContent></Dialog>
  </>;
}

function CompanySources({companyURL,setCompanyURL,research,disabled,onResearch}:{companyURL:string;setCompanyURL:(value:string)=>void;research:CompanyResearch|null;disabled:boolean;onResearch:()=>void}){
  return <div className="company-input"><label className="field"><span>Company website <span className="optional">optional · confirm the correct company</span></span><div className="input-action"><Link2 size={16}/><input type="url" value={companyURL} disabled={disabled} onChange={e=>setCompanyURL(e.target.value)} placeholder="https://company.com"/><button className="button secondary small" disabled={disabled||!companyURL.trim()} onClick={onResearch}>Research</button></div></label><p className="small-note">Reads the homepage and up to seven linked pages about products, strategy, values, careers, and news. AI analysis uses relevant excerpts.</p>{research&&<><p className="research-status">{research.sources.length} pages read{research.failures.length?` · ${research.failures.length} pages unavailable`:""}. Company sources describe the employer, not your experience.</p><details className="research-sources"><summary>View company sources</summary>{research.sources.map(source=><div className="research-source" key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><p>{source.text.slice(0,600)}{source.text.length>600?"…":""}</p></div>)}</details></>}</div>;
}
function ChangeText({before,after,side}:{before:string;after:string;side:"before"|"after"}){
  const a=before.split(/\s+/),b=after.split(/\s+/);let start=0,end=0;
  while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;
  while(end<Math.min(a.length,b.length)-start&&a[a.length-1-end]===b[b.length-1-end])end++;
  const words=side==="before"?a:b,prefix=words.slice(0,start).join(" "),middle=words.slice(start,words.length-end).join(" "),suffix=end?words.slice(-end).join(" "):"";
  return <>{prefix}{prefix&&middle?" ":""}{middle&&(side==="before"?<del className="change-del">{middle}</del>:<ins className="change-ins">{middle}</ins>)}{suffix&&(prefix||middle)?" ":""}{suffix}</>;
}
function OriginalDocumentPreview({source,pdfURL,fileName,blocks,suggestions,style}:{source:UploadedCV|null;pdfURL:string|null;fileName:string;blocks:Block[];suggestions:Suggestion[];style:CVStyle}) {
  if(source?.format==="pdf")return <div className="source-document">
    {pdfURL?<><iframe className="source-pdf-frame" src={pdfURL} title="Original uploaded PDF CV" /><a className="source-open-link" href={pdfURL} target="_blank" rel="noopener noreferrer">Open original PDF in a new tab</a></>:<p className="source-layout-note">Loading the original PDF preview…</p>}
    {source.blocks.some((b,i)=>blocks[i]?.text!==b.text)&&<p className="source-layout-note">This is the original PDF, not a reformatted copy. Approved wording is tracked in the review and cannot be drawn back into the PDF without risking its original layout.</p>}
  </div>;
  if(source?.format==="docx")return <div className="source-word-preview">
    <div className="source-word-heading"><FileText size={32}/><div><h3>Original Word document retained</h3><p>We keep the actual DOCX and patch approved wording into it on export. Browser text extraction cannot display its exact font, spacing, tables or page layout.</p></div></div>
    <button className="button secondary small" onClick={()=>saveBlob(new Blob([source.bytes],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),fileName||"original-cv.docx")}><Download size={15}/> Download original to view in Word</button>
    <details className="source-word-text"><summary>Show current CV wording (text-only, not a layout preview)</summary><div>{blocks.map(b=><p key={b.id}>{b.text}</p>)}</div></details>
  </div>;
  return <CVDocument blocks={blocks} suggestions={suggestions} style={style}/>;
}
function CVDocument({blocks,suggestions,style}:{blocks:Block[];suggestions:Suggestion[];style:CVStyle}) {
  return <article className="cv-paper imported-style" style={{fontFamily:cssFont(style.body),lineHeight:style.lineHeight,padding:`${style.margin*96/72*.6}px`}} aria-label="CV preview">{blocks.map((b,i)=>{
    const textStyle=blockStyle(b,i,style),appearance={fontFamily:cssFont(textStyle),fontSize:`${textStyle.size*96/72}px`,fontWeight:textStyle.bold?700:400,fontStyle:textStyle.italic?"italic":"normal",color:`#${textStyle.color}`,textAlign:textStyle.align,letterSpacing:0,lineHeight:style.lineHeight};
    const changed = suggestions.some(s=>s.blockId===b.id&&s.status==="accepted"),bullet=/^[•●▪\-*]\s*/.test(b.text);
    return i===0?<h2 className="cv-name" style={appearance} key={b.id}>{b.text}</h2>:b.heading?<h3 className="cv-heading" style={{...appearance,borderBottom:style.headingRule?`1px solid #${textStyle.color}`:"none"}} key={b.id}>{b.text.replace(/:$/,"")}</h3>:<p key={b.id} style={appearance} className={`${b.section==="Profile"?"cv-contact":bullet?"cv-line cv-bullet":isEntryLine(b.text)?"cv-line cv-entry":"cv-line"} ${changed?"approved-line":""}`}>{bullet?<><span className="bullet-marker">•</span><span>{b.text.replace(/^[•●▪\-*]\s*/,"")}</span></>:b.text}</p>;
  })}</article>;
}
function SuggestionCard({suggestion:s,index,section,sources,disabled,onDecision,onRevise,onEdit}:{suggestion:Suggestion;index:number;section:string;sources:Evidence[];disabled:boolean;onDecision:(status:"accepted"|"rejected"|"pending")=>void;onRevise:(comment:string)=>void;onEdit:(text:string)=>void}) {
  const [commentOpen,setCommentOpen]=useState(false),[comment,setComment]=useState(s.comment||""),[editing,setEditing]=useState(false),[draft,setDraft]=useState(s.suggested);
  useEffect(()=>{setDraft(s.suggested);},[s.suggested]);
  return <article className={`suggestion-card ${s.status}`}><div className="suggestion-header"><span className="suggestion-number">{String(index).padStart(2,"0")}</span><span className="suggestion-section">{section}</span><span className={`status-pill ${s.status}`}>{s.status==="pending"?"To review":s.status==="accepted"?"Accepted":"Rejected"}</span></div>
    <div className="before"><p className="change-label">CURRENT</p><p><ChangeText before={s.original} after={s.suggested} side="before"/></p></div><div className="after"><p className="change-label"><Sparkles size={12}/> PROPOSED</p>{editing?<textarea aria-label="Edit proposed wording" value={draft} maxLength={1500} disabled={disabled} onChange={e=>setDraft(e.target.value)}/>:<p><ChangeText before={s.original} after={s.suggested} side="after"/></p>}</div>
    {editing&&<div className="manual-actions"><button className="button primary small" disabled={disabled||!draft.trim()||!isMeaningfulEdit(s.original,draft)} onClick={()=>{onEdit(draft.trim());setEditing(false);}}>Save wording</button><button className="text-button" onClick={()=>{setEditing(false);setDraft(s.suggested);}}>Cancel</button></div>}
    <p className="change-reason">{s.reason}</p>{s.jobRequirement&&<p className="job-requirement"><strong>Job requirement:</strong> {s.jobRequirement}</p>}<details className="citation-details"><summary><Link2 size={14}/> {s.citations.length} source {s.citations.length===1?"excerpt":"excerpts"}<ChevronRight size={14}/></summary>{s.citations.map((c,i)=><div key={i}><strong>{sources.find(e=>e.id===c.sourceId)?.name||c.sourceId}</strong><blockquote>{c.quote}</blockquote></div>)}</details>
    {s.status==="pending"?<div className="decision-buttons"><button className="button primary small" disabled={disabled||editing} onClick={()=>onDecision("accepted")}><Check size={15}/> Accept</button><button className="button secondary small" disabled={disabled||editing} onClick={()=>onDecision("rejected")}><X size={15}/> Reject</button><button className="icon-button" disabled={disabled} aria-label="Comment on suggestion" onClick={()=>setCommentOpen(!commentOpen)}><MessageSquare size={17}/></button><button className="icon-button" disabled={disabled} aria-label="Edit suggestion wording" onClick={()=>setEditing(!editing)}><Pencil size={16}/></button></div>:<button className="text-button undo" disabled={disabled} onClick={()=>onDecision("pending")}><Undo2 size={15}/> Undo decision</button>}
    {commentOpen&&s.status==="pending"&&<div className="comment-box"><label className="field"><span>Your feedback</span><textarea value={comment} disabled={disabled} maxLength={1000} onChange={e=>setComment(e.target.value)} placeholder="Keep it shorter, emphasize the evaluation, or change the tone…"/></label><button className="button secondary small" disabled={disabled||!comment.trim()} onClick={()=>onRevise(comment)}><Sparkles size={15}/> Revise this suggestion</button></div>}
  </article>;
}
