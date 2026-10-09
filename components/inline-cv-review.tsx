"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {Check,ChevronLeft,ChevronRight,Download,FileText,MessageSquare,Pencil,Sparkles,Undo2,X} from "lucide-react";
import {pdfRows,type PDFTextItem} from "@/lib/pdf-text";
import {findPDFAnchors,type PDFAnchor} from "@/lib/pdf-anchors";
import {isMeaningfulEdit,type Block,type Suggestion} from "@/lib/cv";
import {saveBlob} from "@/lib/import";
import type {PDFPageProxy,PDFDocumentLoadingTask} from "pdfjs-dist";

type Source={bytes:ArrayBuffer;format:string;blocks:Block[]}|null;
type PDFRow=ReturnType<typeof pdfRows>[number];
type PageData={page:PDFPageProxy;number:number;width:number;height:number;rows:PDFRow[]};
type Props={
  source:Source;fileName:string;blocks:Block[];suggestions:Suggestion[];disabled:boolean;
  onDecision:(id:string,status:"accepted"|"rejected"|"pending")=>void;
  onRevise:(id:string,instruction:string)=>void;
  onEdit:(id:string,text:string)=>void;
};
const stateText=(status:Suggestion["status"])=>status==="pending"?"Needs review":status==="accepted"?"Approved":"Declined";

function PDFPageCanvas({page,scale}:{page:PDFPageProxy;scale:number}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;
    const viewport=page.getViewport({scale});
    const context=el.getContext("2d");if(!context)return;
    const pixelRatio=Math.min(window.devicePixelRatio||1,2);
    el.width=Math.round(viewport.width*pixelRatio);
    el.height=Math.round(viewport.height*pixelRatio);
    const render=page.render({canvas:el,canvasContext:context,viewport,transform:[pixelRatio,0,0,pixelRatio,0,0]});
    void render.promise.catch(e=>{if(e?.name!=="RenderingCancelledException")console.error("PDF page preview failed",e);});
    return ()=>render.cancel();
  },[page,scale]);
  return <canvas ref={canvas} className="editor-pdf-canvas" aria-label="Original PDF page"/>;
}

function PDFReviewDocument({source,suggestions,active,preview,onSelect}:{source:NonNullable<Source>;suggestions:Suggestion[];active:Suggestion|null;preview:"before"|"after";onSelect:(id:string)=>void}){
  const [pages,setPages]=useState<PageData[]>([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const scroll=useRef<HTMLDivElement>(null);
  const scale=1.15;
  useEffect(()=>{
    if(source.format!=="pdf")return;
    let cancelled=false;let task:PDFDocumentLoadingTask|null=null;
    setPages([]);setError("");setLoading(true);
    void (async()=>{
      const pdfjs=await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc="/pdf.worker.min.mjs";
      task=pdfjs.getDocument({data:new Uint8Array(source.bytes.slice(0))});
      const pdf=await task.promise;
      const collected:PageData[]=[];
      for(let n=1;n<=pdf.numPages;n++){
        const page=await pdf.getPage(n);
        const content=await page.getTextContent();
        const viewport=page.getViewport({scale:1});
        collected.push({page,number:n,width:viewport.width,height:viewport.height,rows:pdfRows(content.items.filter(item=>"str" in item) as PDFTextItem[])});
      }
      if(!cancelled)setPages(collected);
    })().catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"Could not display the original PDF.");}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;void task?.destroy();};
  },[source]);
  const anchors=useMemo(()=>findPDFAnchors(source.blocks,pages.map(p=>p.rows)),[source,pages]);
  const activeAnchor=active?anchors[active.blockId]:null;
  useEffect(()=>{
    if(!activeAnchor)return;
    scroll.current?.querySelector<HTMLElement>(`[data-pdf-page="${activeAnchor.page}"]`)?.scrollIntoView({block:"nearest",behavior:"smooth"});
  },[active?.id,activeAnchor?.page]);
  return <div className="editor-original-pdf">
    <div className="editor-pdf-scroll" ref={scroll}>
      {loading&&<p className="editor-wait">Rendering your original PDF…</p>}
      {error&&<p role="alert" className="editor-alert">{error} <span>Use the original PDF link to open it in your browser.</span></p>}
      {pages.map((p,index)=>{
        const viewport=p.page.getViewport({scale});
        const activeHere=active&&activeAnchor?.page===index;
        const rects=activeHere?getRowRects(p,activeAnchor,scale):[];
        const bottom=Math.max(0,...rects.map(r=>r.top+r.height));
        return <div className="editor-pdf-page" key={p.number} data-pdf-page={index} style={{width:viewport.width,height:viewport.height}}>
          <PDFPageCanvas page={p.page} scale={scale}/>
          {suggestions.map((s)=>{
            const a=anchors[s.blockId];if(!a||a.page!==index)return null;
            const r=getRowRects(p,a,scale);
            return <div key={s.id}>
              {r.map((rect,i)=><button key={i} type="button" className={`editor-pdf-marker ${s.id===active?.id?"selected":""} ${s.status}`} style={rect} onClick={()=>onSelect(s.id)} title={`View suggested edit: ${s.original.slice(0,90)}`} aria-label={`Select suggestion for: ${s.original.slice(0,80)}`}/>)}
            </div>;
          })}
          {activeHere&&rects.length>0&&preview==="after"&&active&&<div className="editor-pdf-annotation" style={{top:Math.min(viewport.height-35,bottom+7),left:Math.min(viewport.width-240,Math.max(8,rects[0].left)),maxWidth:Math.min(355,viewport.width-20)}}><strong>{active.status==="accepted"?"Approved wording":"Proposed wording"}</strong><p>{active.status==="rejected"?active.original:active.suggested}</p><small>Visual annotation only — PDF text has not been replaced.</small></div>}
        </div>;
      })}
    </div>
    <p className="editor-accuracy-note">Pages are rendered from the uploaded PDF, with suggestions highlighted in place. Proposed wording is an overlay, not a reflowed PDF. Exact-layout PDF export with edits is not available.</p>
  </div>;
}
function getRowRects(page:PageData,anchor:PDFAnchor,scale:number){
  const viewport=page.page.getViewport({scale});
  return page.rows.slice(anchor.firstRow,anchor.lastRow+1).map(row=>{
    const [x1,y1]=viewport.convertToViewportPoint(row.x,row.y-2);
    const [x2,y2]=viewport.convertToViewportPoint(row.x+Math.max(row.width,12),row.y+Math.max(row.height,9));
    return {left:Math.max(0,Math.min(x1,x2)-2),top:Math.max(0,Math.min(y1,y2)-2),width:Math.abs(x2-x1)+4,height:Math.abs(y2-y1)+4};
  });
}

function TextReviewDocument({source,blocks,suggestions,active,preview,onSelect,fileName}:{source:Source;blocks:Block[];suggestions:Suggestion[];active:Suggestion|null;preview:"before"|"after";onSelect:(id:string)=>void;fileName:string}){
  const docx=source?.format==="docx";
  return <div className="editor-text-paper">
    {docx&&<div className="editor-word-disclaimer"><FileText size={20}/><div><strong>Word content review — original DOCX retained</strong><p>The browser view below is text-only, not Word's precise pagination. Export patches the original file and preserves its styles, although longer text may reflow.</p><button className="text-button" onClick={()=>saveBlob(new Blob([source.bytes],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),fileName||"original.docx")}><Download size={13}/> Download original</button></div></div>}
    <div className="editor-text-lines">{blocks.map((block,i)=>{
      const s=suggestions.find(entry=>entry.blockId===block.id);
      const showingSuggestion=s&&s.id===active?.id&&preview==="after"&&s.status!=="rejected";
      return <div key={block.id} className={`editor-text-line ${s?"with-edit":""} ${active?.id===s?.id?"is-active":""}`}>
        {s&&<button type="button" aria-label={`Review suggestion for ${block.text.slice(0,75)}`} className="editor-text-dot" onClick={()=>onSelect(s.id)}><Sparkles size={13}/></button>}
        {i===0?<h2>{block.text}</h2>:block.heading?<h3>{block.text}</h3>:<p>{block.text}</p>}
        {showingSuggestion&&<div className="editor-text-proposal"><span><Sparkles size={13}/> {s.status==="accepted"?"Approved text":"Proposed replacement"}</span><p>{s.suggested}</p></div>}
      </div>;
    })}</div>
  </div>;
}

export default function InlineCVReview({source,fileName,blocks,suggestions,disabled,onDecision,onRevise,onEdit}:Props){
  const [activeId,setActiveId]=useState<string|null>(null);
  const [preview,setPreview]=useState<"before"|"after">("after");
  const [editMode,setEditMode]=useState(false),[editText,setEditText]=useState("");
  const [request,setRequest]=useState("");
  const [showRequest,setShowRequest]=useState(false);
  const reviewIds=suggestions.map(s=>s.id).join("|");
  useEffect(()=>{setActiveId(suggestions.find(s=>s.status==="pending")?.id??suggestions[0]?.id??null);setPreview("after");setEditMode(false);setShowRequest(false);},[reviewIds]);
  const active=suggestions.find(s=>s.id===activeId)??suggestions[0]??null;
  const position=active?suggestions.findIndex(s=>s.id===active.id):-1;
  const go=(direction:number)=>{if(!suggestions.length)return;setActiveId(suggestions[(position+direction+suggestions.length)%suggestions.length].id);setPreview("after");setEditMode(false);setShowRequest(false);};
  const focused=(id:string)=>{setActiveId(id);setPreview("after");setEditMode(false);setShowRequest(false);};
  const decide=(status:"accepted"|"rejected"|"pending")=>{if(!active)return;onDecision(active.id,status);};
  return <div className="editor-layout">
    <section className="editor-document-pane">
      <div className="editor-pane-header"><span><FileText size={17}/> {source?.format==="pdf"?"Original PDF with anchored edits":source?.format==="docx"?"Word text review":"CV draft"}</span><span>{suggestions.length} edit{suggestions.length===1?"":"s"}</span></div>
      {source?.format==="pdf"?<PDFReviewDocument source={source} suggestions={suggestions} active={active} preview={preview} onSelect={focused}/>:<TextReviewDocument source={source} blocks={blocks} suggestions={suggestions} active={active} preview={preview} onSelect={focused} fileName={fileName}/>}
    </section>
    <aside className="editor-review-pane" aria-label="AI suggestion editor">
      {active?<div className="editor-suggestion">
        <div className="editor-nav"><span><Sparkles size={16}/> Suggestion {position+1} of {suggestions.length}</span><div><button aria-label="Previous suggestion" disabled={disabled} onClick={()=>go(-1)}><ChevronLeft size={18}/></button><button aria-label="Next suggestion" disabled={disabled} onClick={()=>go(1)}><ChevronRight size={18}/></button></div></div>
        <p className="editor-edit-status">{stateText(active.status)} · {blocks.find(b=>b.id===active.blockId)?.section||"CV"}</p>
        <div className="editor-preview-switch"><button className={preview==="before"?"chosen":""} onClick={()=>setPreview("before")}>Original</button><button className={preview==="after"?"chosen":""} onClick={()=>setPreview("after")}>Suggested</button></div>
        <div className="editor-comparison">
          <span>{preview==="before"?"ORIGINAL TEXT":"PROPOSED TEXT"}</span>
          {editMode&&preview==="after"?<textarea value={editText} maxLength={1500} onChange={e=>setEditText(e.target.value)} aria-label="Edit the proposed replacement"/>:<p>{preview==="before"?active.original:active.suggested}</p>}
        </div>
        {editMode?<div className="editor-actions"><button className="button primary small" disabled={disabled||!isMeaningfulEdit(active.original,editText)||!editText.trim()} onClick={()=>{onEdit(active.id,editText.trim());setEditMode(false);}}>Save edit</button><button className="button secondary small" onClick={()=>setEditMode(false)}>Cancel</button></div>:null}
        <div className="editor-rationale"><strong>Why this change?</strong><p>{active.reason}</p>{active.jobRequirement&&<p><strong>Job requirement:</strong> {active.jobRequirement}</p>}</div>
        {active.status==="pending"?<div className="editor-actions">
          <button className="button primary small" disabled={disabled||editMode} onClick={()=>decide("accepted")}><Check size={15}/> Accept</button>
          <button className="button secondary small" disabled={disabled||editMode} onClick={()=>decide("rejected")}><X size={15}/> Reject</button>
          <button className="button secondary small" disabled={disabled} onClick={()=>{setEditText(active.suggested);setEditMode(true);setPreview("after");}}><Pencil size={15}/> Modify</button>
        </div>:<button className="button secondary small" disabled={disabled} onClick={()=>decide("pending")}><Undo2 size={15}/> Undo decision</button>}
        {active.status==="pending"&&<div className="editor-revision">
          <button className="text-button" disabled={disabled} onClick={()=>setShowRequest(!showRequest)}><MessageSquare size={15}/> Ask Groq to revise this</button>
          {showRequest&&<><label htmlFor="editor-ai-request">Tell the AI what to change</label><textarea id="editor-ai-request" value={request} onChange={e=>setRequest(e.target.value)} maxLength={1000} placeholder="e.g. More concise, emphasize the impact, don't add unverified metrics…"/><button className="button secondary small" disabled={disabled||!request.trim()} onClick={()=>onRevise(active.id,request)}>Generate another version</button></>}
        </div>}
        {active.citations.length>0&&<details className="editor-evidence"><summary>Evidence used ({active.citations.length})</summary>{active.citations.map((citation,i)=><blockquote key={i}>{citation.quote}</blockquote>)}</details>}
      </div>:<div className="editor-no-suggestions"><Sparkles size={21}/><h3>No wording changes proposed yet</h3><p>Use AI review to generate grounded suggestions. The uploaded CV remains unchanged.</p></div>}
      <div className="editor-index">{suggestions.map((s,i)=><button key={s.id} className={s.id===active?.id?"selected":""} onClick={()=>focused(s.id)} title={`Suggestion ${i+1}: ${stateText(s.status)}`} aria-label={`Go to suggestion ${i+1}`}>{i+1}</button>)}</div>
    </aside>
  </div>;
}
