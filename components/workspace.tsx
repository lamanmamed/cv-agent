"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, BriefcaseBusiness, Layers, Check, X, MessageSquare, Download, Settings2, ShieldCheck, GitFork as Github, Sparkles, Undo2, Plus, BookOpen, LoaderCircle, Link2, Pencil, ChevronRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Toaster, toast } from "sonner";
import { applyDecision, cvSources, keywordReport, localAnalysis, parseCV, SAMPLE_CV, SAMPLE_EVIDENCE, SAMPLE_JOB, type Block, type Evidence, type Suggestion, type Analysis } from "@/lib/cv";
import { readCV, readEvidence, saveBlob } from "@/lib/import";

const errorText = (e: unknown) => e instanceof Error ? e.message : "Something went wrong. Please try again.";
type ModelContext = { registerTool: (tool: {name: string; title: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => unknown}, options: {signal: AbortSignal}) => void | Promise<void> };

export default function Workspace() {
  const [tab, setTab] = useState("sources");
  const [cvText, setCVText] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]), [original, setOriginal] = useState<Block[]>([]);
  const [job, setJob] = useState(""), [jobURL, setJobURL] = useState(""), [githubURL, setGithubURL] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]), [analysisMode, setAnalysisMode] = useState<"local" | "groq" | null>(null);
  const [busy, setBusy] = useState(""), [settings, setSettings] = useState(false), [key, setKey] = useState("");
  const [fileName, setFileName] = useState(""), [sample, setSample] = useState(false), [showRaw, setShowRaw] = useState(false);
  const [filter, setFilter] = useState("pending");
  const cvInput = useRef<HTMLInputElement>(null), evidenceInput = useRef<HTMLInputElement>(null);
  const current = useRef({ blocks, original, evidence, job, suggestions }); current.current = { blocks, original, evidence, job, suggestions };
  const report = keywordReport(blocks, job, evidence), accepted = suggestions.filter(s => s.status === "accepted").length, pending = suggestions.filter(s => s.status === "pending").length;
  const sources = cvSources(original.length ? original : blocks, evidence);

  function setCV(text: string, name = "Pasted CV") {
    const parsed = parseCV(text); setCVText(text); setBlocks(parsed); setOriginal(parsed); setFileName(name);
    setSuggestions([]); setAnalysisMode(null); setSample(false);
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
    try {setCV(await readCV(file), file.name); setShowRaw(false); toast.success("CV imported. Check the extracted text before analyzing.");}
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
      const data = await res.json() as {error?:string;text:string;sources:Evidence[]}; if(!res.ok) throw new Error(data.error || "Could not read the link.");
      if(kind === "job") {setJob(data.text); toast.success("Job description imported. Please check the extracted text.");}
      else {
        const combined = [...evidence, ...data.sources] as Evidence[];
        if(combined.length > 12 || combined.reduce((n,e)=>n+e.text.length,0)>25000) throw new Error("Evidence limit reached. Remove a source first.");
        setEvidence(combined); setGithubURL(""); toast.success(`${data.sources.length} README sources added.`);
      }
      setSuggestions([]); setAnalysisMode(null);
    } catch(e) {toast.error(errorText(e));} finally {setBusy("");}
  }
  async function analyze() {
    if(!blocks.length || job.trim().length<40) {toast.error("Add your CV and a job description of at least 40 characters."); return;}
    setBusy(key ? "Generating source-linked suggestions" : "Checking wording and job keywords");
    try {
      let analysis: Analysis;
      if(key) {
        const res = await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({blocks,job,evidence,key})});
        const data = await res.json() as Analysis & {error?:string}; if(!res.ok) throw new Error(data.error || "Analysis failed."); analysis = data;
      } else analysis = localAnalysis(blocks, job, evidence);
      setOriginal(blocks); setSuggestions(analysis.suggestions); setAnalysisMode(analysis.mode); setTab("review"); setFilter("pending");
      toast.success(analysis.suggestions.length ? `${analysis.suggestions.length} changes ready to review.` : "Analysis complete. No wording changes were proposed.");
    } catch(e) {toast.error(errorText(e));} finally {setBusy("");}
  }
  async function revise(id: string, comment: string) {
    if(!key) {toast.info("Add a Groq key in AI settings for comment-based revisions. You can also edit the proposed wording yourself."); return;}
    if(!comment.trim()) {toast.error("Add a comment explaining what to change."); return;}
    const suggestion = suggestions.find(s=>s.id===id); if(!suggestion || suggestion.status !== "pending") return;
    setBusy(`Revising ${id}`);
    try {
      const res = await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({blocks:original,job,evidence,key,revision:{suggestion,comment}})});
      const data = await res.json() as Analysis & {error?:string}; if(!res.ok) throw new Error(data.error || "Revision failed.");
      if(!data.suggestions?.length) throw new Error("No revised suggestion was returned.");
      setSuggestions(prev=>prev.map(s=>s.id===id ? {...data.suggestions[0],id,status:"pending",comment} : s)); toast.success("Suggestion revised. Your CV is unchanged until you accept it.");
    } catch(e) {toast.error(errorText(e));} finally {setBusy("");}
  }
  async function exportDOCX() {
    setBusy("Preparing DOCX");
    try {
      const {Document, Paragraph, TextRun, Packer, HeadingLevel} = await import("docx");
      const doc = new Document({styles:{default:{document:{run:{font:"Arial",size:22},paragraph:{spacing:{after:100}}}}},sections:[{properties:{page:{margin:{top:850,bottom:850,left:1000,right:1000}}},children:blocks.map((b,i)=>new Paragraph({heading:i===0?HeadingLevel.TITLE:b.heading?HeadingLevel.HEADING_2:undefined,children:[new TextRun({text:b.text,color:"172921",bold:b.heading})],spacing:{before:b.heading?220:0,after:100}}))}]});
      saveBlob(await Packer.toBlob(doc), "tailored-cv.docx"); toast.success("DOCX downloaded.");
    } catch(e) {toast.error(errorText(e));} finally {setBusy("");}
  }
  function loadSample() {setCV(SAMPLE_CV,"Sample CV · Avery Chen");setJob(SAMPLE_JOB);setEvidence(SAMPLE_EVIDENCE);setSample(true);toast.info("Fictional sample loaded. No personal data or API calls.");}
  function safeDecision(id: string, status: "accepted" | "rejected" | "pending") {try {decide(id,status);} catch(e) {toast.error(errorText(e));}}

  return <>
    <Toaster position="bottom-right" richColors />
    <header className="topbar">
      <a href="/" className="brand"><span className="brand-icon"><FileText size={22}/></span><span>CV<span className="brand-light"> Agent</span></span><span className="beta">BETA</span></a>
      <div className="header-actions"><span className="privacy-label"><ShieldCheck size={16}/> Your changes, your approval</span><button className="button secondary small" onClick={()=>setSettings(true)}><Settings2 size={16}/><span>AI settings</span></button><a className="icon-button" href="https://github.com/lamanmamed/cv-agent" target="_blank" rel="noreferrer" aria-label="View source on GitHub"><Github size={20}/></a></div>
    </header>
    <main className="workspace">
      <div className="page-heading"><div><p className="eyebrow">THE CV WORKSPACE</p><h1>Tailor your CV.</h1><p className="subtitle">Bring the role. Keep your story. Review every change.</p></div><button className="button secondary" onClick={loadSample} disabled={!!busy || !!blocks.length}><BookOpen size={17}/> Try a sample</button></div>
      <Tabs value={tab} onValueChange={setTab} className="workspace-tabs">
        <div className="workflow-bar"><TabsList className="steps" variant="line"><TabsTrigger value="sources"><span className="step-number">1</span> Add your sources</TabsTrigger><TabsTrigger value="review" disabled={!analysisMode}><span className="step-number">2</span> Review changes{pending>0&&<span className="count">{pending}</span>}</TabsTrigger><TabsTrigger value="export" disabled={!blocks.length}><span className="step-number">3</span> Export CV</TabsTrigger></TabsList><span className="mode-label">{key ? "Groq connected · session only" : "Local mode · no API calls"}</span></div>
        <TabsContent value="sources">
          <div className="sources-grid">
            <section className="panel cv-panel">
              <div className="panel-title"><span className="section-icon"><FileText size={19}/></span><div><h2>Your CV</h2><p>Start with what you already have.</p></div>{fileName&&<span className="pill">{sample?"Sample":"Imported"}</span>}</div>
              <input type="file" ref={cvInput} accept=".pdf,.docx,.txt,.md" hidden onChange={e=>uploadCV(e.target.files?.[0])}/>
              <button className={`upload-zone ${blocks.length ? "has-file" : ""}`} disabled={!!busy} onClick={()=>cvInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void uploadCV(e.dataTransfer.files[0]);}}>
                <span className="upload-icon">{blocks.length?<FileText size={25}/>:<Upload size={25}/>}</span><strong>{fileName || "Drop your CV here"}</strong><span>{blocks.length ? "Click to replace your CV" : "or click to choose a file"}</span><small>PDF, DOCX, TXT · up to 10 MB</small>
              </button>
              <div className="split-label"><span>{blocks.length?`${blocks.length} text lines extracted`:"Prefer to paste it?"}</span><button className="text-button" disabled={!!busy} onClick={()=>setShowRaw(!showRaw)}>{showRaw?"Hide text":blocks.length?"Check extracted text":"Paste CV text"}</button></div>
              {showRaw&&<label className="field"><span>CV text</span><textarea className="cv-text-input" value={cvText} maxLength={25000} disabled={!!busy} onChange={e=>setCV(e.target.value)} placeholder="Paste your CV, including section headings…" /></label>}
              {blocks.length>0&&!showRaw&&<div className="mini-preview"><p className="preview-label">TEXT PREVIEW</p>{blocks.slice(0,5).map(b=><p className={b.heading?"mini-heading":""} key={b.id}>{b.text}</p>)}{blocks.length>5&&<span className="muted">+ {blocks.length-5} more lines</span>}</div>}
              <div className="source-note"><ShieldCheck size={17}/><p>Files are read in your browser. They aren’t stored on our server. AI mode sends extracted text to Groq when you request an analysis.</p></div>
            </section>
            <div className="context-column">
              <section className="panel job-panel"><div className="panel-title"><span className="section-icon blue"><BriefcaseBusiness size={19}/></span><div><h2>The role you want</h2><p>Paste the description or import a job link.</p></div></div>
                <label className="field"><span>Job description</span><textarea value={job} disabled={!!busy} maxLength={15000} onChange={e=>{setJob(e.target.value);setAnalysisMode(null);setSuggestions([]);}} placeholder="Paste the responsibilities, requirements, and skills for the role…" className="job-input" /></label>
                <label className="field"><span>Or use a job link <span className="optional">Greenhouse, Lever, Ashby</span></span><div className="input-action"><Link2 size={16}/><input type="url" value={jobURL} disabled={!!busy} onChange={e=>setJobURL(e.target.value)} placeholder="https://jobs.lever.co/company/…"/><button className="button secondary small" disabled={!!busy||!jobURL} onClick={()=>importLink("job")}>Import</button></div></label>
              </section>
              <section className="panel evidence-panel"><div className="panel-title"><span className="section-icon purple"><Layers size={19}/></span><div><h2>Back it up with your work</h2><p>Projects can support a more specific CV.</p></div><span className="optional">OPTIONAL</span></div>
                <label className="field"><span>Public GitHub repository or profile</span><div className="input-action"><Github size={17}/><input type="url" value={githubURL} disabled={!!busy} onChange={e=>setGithubURL(e.target.value)} placeholder="https://github.com/you/project"/><button className="button secondary small" disabled={!!busy||!githubURL} onClick={()=>importLink("github")}>Add</button></div></label>
                <input ref={evidenceInput} hidden type="file" multiple accept=".zip,.md,.txt,.pdf,.docx" onChange={e=>uploadEvidence(Array.from(e.target.files||[]))}/>
                <button className="evidence-upload" disabled={!!busy} onClick={()=>evidenceInput.current?.click()}><Plus size={18}/> Add a project ZIP, README, or document<span>10 MB max</span></button>
                {evidence.length>0&&<div className="source-list">{evidence.map(e=><div key={e.id}><FileText size={15}/><span title={e.name}>{e.name}</span><button className="icon-button" disabled={!!busy} aria-label={`Remove ${e.name}`} onClick={()=>{setEvidence(prev=>prev.filter(s=>s.id!==e.id));setAnalysisMode(null);setSuggestions([]);}}><X size={14}/></button></div>)}</div>}
                <p className="small-note">We read selected text files only. Uploaded code is never executed. GitHub imports read public READMEs.</p>
              </section>
            </div>
          </div>
          <div className="analyze-bar"><div><ShieldCheck size={20}/><p><strong>Better wording. Real experience.</strong><span>Suggestions stay separate until you approve them.</span></p></div><button className="button primary analyze-button" onClick={analyze} disabled={!!busy||!blocks.length||job.trim().length<40}>{busy?<LoaderCircle className="spin" size={19}/>:<Sparkles size={19}/>} {busy||"Analyze my CV"}</button></div>
        </TabsContent>
        <TabsContent value="review">
          <div className="review-summary"><div><h2>Make it yours.</h2><p>{analysisMode==="local"?"Local wording checks and a technical keyword scan. Enable Groq for AI tailoring and comment-based revisions.":"AI suggestions are linked to source excerpts. Check that each claim describes your own work."}</p></div><span className="review-count"><strong>{accepted}</strong> / {suggestions.length} accepted</span></div>
          <div className="review-grid">
            <section className="document-panel"><div className="document-toolbar"><span><FileText size={16}/> Your current CV</span><span>{accepted ? `${accepted} approved changes` : "Original text"}</span></div><CVDocument blocks={blocks} suggestions={suggestions}/><p className="paper-caption">Single-column template · selectable text · only approved edits</p></section>
            <section className="suggestions-panel">
              <div className="keyword-panel"><div className="keyword-title"><h3>Job keyword coverage</h3><span>{report.matched.length} / {report.requirements.length} found in CV</span></div>
                <div className="keyword-tags">{report.matched.map(s=><span className="keyword matched" key={s}><Check size={12}/>{s}</span>)}{report.evidenceOnly.map(s=><span className="keyword evidence" key={s}>{s} · in evidence</span>)}{report.missing.map(s=><span className="keyword missing" key={s}>{s} · gap</span>)}</div>
                <p>Technical term scan, not an ATS score. A mention in project evidence needs your confirmation before becoming a CV claim.</p>
              </div>
              <Tabs value={filter} onValueChange={setFilter}><TabsList className="review-filters"><TabsTrigger value="pending">To review ({pending})</TabsTrigger><TabsTrigger value="all">All changes ({suggestions.length})</TabsTrigger></TabsList><TabsContent value={filter}>
                <div className="suggestion-list">{suggestions.filter(s=>filter==="all"||s.status==="pending").map((s,i)=><SuggestionCard key={s.id} suggestion={s} index={i+1} section={original.find(b=>b.id===s.blockId)?.section||"CV"} sources={sources} disabled={!!busy} onDecision={status=>safeDecision(s.id,status)} onRevise={comment=>revise(s.id,comment)} onEdit={text=>setSuggestions(prev=>prev.map(item=>item.id===s.id?{...item,suggested:text,reason:"Wording edited by you. Confirm the claims before accepting."}:item))}/>)}</div>
                {(filter==="pending"?pending===0:suggestions.length===0)&&<div className="empty-review"><Check size={28}/><h3>{suggestions.length?"All changes reviewed":"No wording changes proposed"}</h3><p>{suggestions.length?"Your approved changes are in the CV. You can undo a decision under All changes.":"Review keyword gaps above. Local mode only makes conservative wording edits; enable Groq for deeper tailoring."}</p><button className="button primary" onClick={()=>setTab("export")}>Continue to export</button></div>}
              </TabsContent></Tabs>
            </section>
          </div>
        </TabsContent>
        <TabsContent value="export">
          <div className="export-grid"><section><div className="eyebrow">READY WHEN YOU ARE</div><h2 className="export-heading">Your experience.<br/>Your final say.</h2><p className="export-copy">Download the CV with your approved changes in a clean, single-column format. Unreviewed suggestions are excluded.</p><div className="export-status"><Check size={18}/>{accepted} changes accepted{pending>0&&<span> · {pending} still pending</span>}</div>
            <div className="export-actions"><button className="button primary" onClick={exportDOCX} disabled={!!busy}><Download size={18}/> Download DOCX</button><button className="button secondary" onClick={()=>window.print()} disabled={!!busy}><FileText size={18}/> Print / Save as PDF</button><button className="text-button" onClick={()=>saveBlob(new Blob([blocks.map(b=>b.text).join("\n")],{type:"text/plain;charset=utf-8"}),"tailored-cv.txt")}><Download size={16}/> Download plain text</button></div>
            <div className="export-note"><h3>A simple format that travels well.</h3><p>Standard headings, readable text, and no tables or graphics. The original layout is replaced by this template. Review the print preview for page breaks.</p></div>
            <button className="text-button" onClick={()=>saveBlob(new Blob([JSON.stringify({version:1,cv:blocks,original,suggestions,evidence,job},null,2)],{type:"application/json"}),"cv-agent-review.json")}><Download size={16}/> Save review history</button><p className="small-note">This session is temporary. Download your work before closing the tab. Review history contains your CV, job text, and evidence.</p>
          </section><section className="document-panel"><CVDocument blocks={blocks} suggestions={[]}/></section></div>
        </TabsContent>
      </Tabs>
      <footer className="footer"><span>CV Agent</span><p>Job alignment and formatting guidance. No universal ATS score or guaranteed outcome.</p><a href="https://github.com/lamanmamed/cv-agent" target="_blank" rel="noreferrer">Built in the open <Github size={14}/></a></footer>
    </main>
    <div className="print-only"><CVDocument blocks={blocks} suggestions={[]}/></div>
    <Dialog open={settings} onOpenChange={setSettings}><DialogContent className="settings-dialog"><DialogTitle>AI settings</DialogTitle><DialogDescription>Local mode is ready to use without an account or API calls. Add your own Groq API key for AI tailoring and revisions.</DialogDescription><label className="field"><span>Groq API key</span><input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value.trim())} placeholder="gsk_…"/></label><p className="small-note">The key stays in this tab’s memory and is sent to our analysis endpoint only when you request AI work. CV and project text are then sent to Groq. Use a free-plan key to stay within your account’s free quota.</p><a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-button">Get a Groq key</a><div className="dialog-actions"><button className="button secondary" onClick={()=>{setKey("");setSettings(false);}}>Use local mode</button><button className="button primary" onClick={()=>setSettings(false)}>{key?"Use Groq":"Done"}</button></div></DialogContent></Dialog>
  </>;
}

function CVDocument({blocks,suggestions}:{blocks:Block[];suggestions:Suggestion[]}) {
  return <article className="cv-paper" aria-label="CV preview">{blocks.map((b,i)=>{
    const changed = suggestions.some(s=>s.blockId===b.id&&s.status==="accepted");
    return i===0?<h2 className="cv-name" key={b.id}>{b.text}</h2>:b.heading?<h3 className="cv-heading" key={b.id}>{b.text.replace(/:$/,"")}</h3>:<p key={b.id} className={`${i<3?"cv-contact":"cv-line"} ${changed?"approved-line":""}`}>{b.text}</p>;
  })}</article>;
}
function SuggestionCard({suggestion:s,index,section,sources,disabled,onDecision,onRevise,onEdit}:{suggestion:Suggestion;index:number;section:string;sources:Evidence[];disabled:boolean;onDecision:(status:"accepted"|"rejected"|"pending")=>void;onRevise:(comment:string)=>void;onEdit:(text:string)=>void}) {
  const [commentOpen,setCommentOpen]=useState(false),[comment,setComment]=useState(s.comment||""),[editing,setEditing]=useState(false),[draft,setDraft]=useState(s.suggested);
  useEffect(()=>{setDraft(s.suggested);},[s.suggested]);
  return <article className={`suggestion-card ${s.status}`}><div className="suggestion-header"><span className="suggestion-number">{String(index).padStart(2,"0")}</span><span className="suggestion-section">{section}</span><span className={`status-pill ${s.status}`}>{s.status==="pending"?"To review":s.status==="accepted"?"Accepted":"Rejected"}</span></div>
    <div className="before"><p className="change-label">CURRENT</p><p>{s.original}</p></div><div className="after"><p className="change-label"><Sparkles size={12}/> PROPOSED</p>{editing?<textarea aria-label="Edit proposed wording" value={draft} maxLength={1500} disabled={disabled} onChange={e=>setDraft(e.target.value)}/>:<p>{s.suggested}</p>}</div>
    {editing&&<div className="manual-actions"><button className="button primary small" disabled={disabled||!draft.trim()||draft===s.original} onClick={()=>{onEdit(draft.trim());setEditing(false);}}>Save wording</button><button className="text-button" onClick={()=>{setEditing(false);setDraft(s.suggested);}}>Cancel</button></div>}
    <p className="change-reason">{s.reason}</p><details className="citation-details"><summary><Link2 size={14}/> {s.citations.length} source {s.citations.length===1?"excerpt":"excerpts"}<ChevronRight size={14}/></summary>{s.citations.map((c,i)=><div key={i}><strong>{sources.find(e=>e.id===c.sourceId)?.name||c.sourceId}</strong><blockquote>{c.quote}</blockquote></div>)}</details>
    {s.status==="pending"?<div className="decision-buttons"><button className="button primary small" disabled={disabled||editing} onClick={()=>onDecision("accepted")}><Check size={15}/> Accept</button><button className="button secondary small" disabled={disabled||editing} onClick={()=>onDecision("rejected")}><X size={15}/> Reject</button><button className="icon-button" disabled={disabled} aria-label="Comment on suggestion" onClick={()=>setCommentOpen(!commentOpen)}><MessageSquare size={17}/></button><button className="icon-button" disabled={disabled} aria-label="Edit suggestion wording" onClick={()=>setEditing(!editing)}><Pencil size={16}/></button></div>:<button className="text-button undo" disabled={disabled} onClick={()=>onDecision("pending")}><Undo2 size={15}/> Undo decision</button>}
    {commentOpen&&s.status==="pending"&&<div className="comment-box"><label className="field"><span>Your feedback</span><textarea value={comment} disabled={disabled} maxLength={1000} onChange={e=>setComment(e.target.value)} placeholder="Keep it shorter, emphasize the evaluation, or change the tone…"/></label><button className="button secondary small" disabled={disabled||!comment.trim()} onClick={()=>onRevise(comment)}><Sparkles size={15}/> Revise this suggestion</button></div>}
  </article>;
}
