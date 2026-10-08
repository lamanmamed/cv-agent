import type { Evidence } from "./cv";
import {pdfItemsToText,type PDFTextItem} from "./pdf-text.ts";
import {inferPDFStyle,inferDOCXStyle,defaultCVStyle,type CVStyle,type StyledPDFPage} from "./cv-style.ts";
import {normalizedEdit} from "./cv.ts";
const MAX_FILE = 10 * 1024 * 1024;
export function redactSecrets(text: string) {
  return text.replace(/\b(?:ghp_|github_pat_|gsk_|sk-)[A-Za-z0-9_-]{16,}\b/g, "[REDACTED TOKEN]").replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]").replace(/((?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*)["']?[^\s"'\n]{8,}["']?/gi, "$1[REDACTED]");
}
export async function readCVDocument(file: File): Promise<{text:string;style:CVStyle;bytes:ArrayBuffer|null;format:string}> {
  if (file.size > MAX_FILE) throw new Error("Use a CV smaller than 10 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase(); let text = "",style=defaultCVStyle();let bytes:ArrayBuffer|null=null;
  if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist"); pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    bytes=await file.arrayBuffer();const loading = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
    const pages:StyledPDFPage[]=[];
    const pdf = await loading.promise;
    try {
      if (pdf.numPages > 20) throw new Error("Use a CV with no more than 20 pages.");
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i), content = await page.getTextContent();
        const items=content.items.filter(item=>"str" in item) as (PDFTextItem&{fontName?:string})[],operators=await page.getOperatorList(),fonts:Record<string,string>={},colors:Record<string,string>={};
        for(const item of items){if(!item.fontName)continue;try{fonts[item.fontName]=(page.commonObjs.get(item.fontName) as {name?:string}).name||content.styles[item.fontName]?.fontFamily||"Arial";}catch{fonts[item.fontName]=content.styles[item.fontName]?.fontFamily||"Arial";}}
        let color="111111",hasRules=false;
        operators.fnArray.forEach((fn,index)=>{const args=operators.argsArray[index];if(fn===pdfjs.OPS.setFillRGBColor){const value=args[0];color=typeof value==="string"?value.replace("#",""):Array.from(args as number[]).slice(0,3).map(c=>Math.round(c<=1?c*255:c).toString(16).padStart(2,"0")).join("");}if(fn===pdfjs.OPS.stroke)hasRules=true;if(fn===pdfjs.OPS.showText){const chars=(args[0] as ({unicode?:string}|number)[]).map(g=>typeof g==="object"?g.unicode||"":"").join("");if(chars.length>3)colors[normalizedEdit(chars)]=color;}});
        const viewport=page.getViewport({scale:1});pages.push({width:viewport.width,height:viewport.height,items,fonts,colors,hasRules});
        text += pdfItemsToText(items)+"\n\n";
      }
    style=inferPDFStyle(pages,text);
    } finally { await loading.destroy(); }
  } else if (extension === "docx") {const mammoth = await import("mammoth");bytes=await file.arrayBuffer();text=(await mammoth.extractRawText({arrayBuffer:bytes})).value;const JSZip=(await import("jszip")).default,zip=await JSZip.loadAsync(bytes);style=inferDOCXStyle(await zip.file("word/document.xml")!.async("string"),text);}
  else if (["txt", "md"].includes(extension || "")) text = await file.text();
  else throw new Error("Choose a PDF, DOCX, TXT, or Markdown CV.");
  if (!text.trim()) throw new Error("No readable text was found. For a scanned CV, paste the text instead.");
  if (text.length > 25000) throw new Error("The extracted CV is too long. Use a shorter CV or paste the relevant text.");
  return {text:text.trim(),style,bytes,format:extension||"text"};
}
export async function readCV(file:File):Promise<string>{return (await readCVDocument(file)).text;}
export async function readEvidence(file: File): Promise<{sources: Evidence[]; skipped: number}> {
  if (file.size > MAX_FILE) throw new Error("Use evidence files smaller than 10 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "zip") {
    const text = extension === "pdf" || extension === "docx" ? await readCV(file) : await file.text();
    if (text.length > 25000) throw new Error("Evidence is too long. Upload a concise README or project summary.");
    return { sources: [{ id: crypto.randomUUID(), name: file.name, text: redactSecrets(text) }], skipped: 0 };
  }
  const JSZip = (await import("jszip")).default, zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter(f => !f.dir);
  if (entries.length > 3000) throw new Error("This ZIP has too many files. Upload just the project source or README.");
  const allowed = entries.filter(f => /\.(md|txt|py|ts|tsx|js|jsx|json|ipynb|r|sql|java|rs|go|cpp|c|yaml|yml)$/i.test(f.name) && !/(^|\/)(node_modules|\.git|venv|\.venv|dist|build|__pycache__)(\/|$)|(^|\/)[.]|lock\.(json|yaml)$|(^|\/)(credentials|secrets|package-lock|pnpm-lock)|\.env/i.test(f.name));
  allowed.sort((a,b) => Number(!/readme/i.test(a.name)) - Number(!/readme/i.test(b.name)));
  const sources: Evidence[] = []; let total = 0;
  for (const entry of allowed.slice(0, 12)) {
    const text = await new Promise<string>((resolve,reject) => {
      type Stream = {on(event:string,callback:(chunk:string)=>void):Stream;pause():void;resume():void};
      let value = ""; const stream = (entry as typeof entry & {internalStream(type:string):Stream}).internalStream("string");
      stream.on("data", (chunk:string) => {value += chunk; if (value.length > 15000 || total + value.length > 25000) {stream.pause(); reject(new Error("size"));}}).on("end", () => resolve(value)).on("error", error=>reject(error)).resume();
    }).catch(() => "");
    if (!text.trim() || text.includes("\u0000")) continue; total += text.length;
    sources.push({ id: crypto.randomUUID(), name: `${file.name}/${entry.name}`, text: redactSecrets(text) });
  }
  if (!sources.length) throw new Error("No readable project files were found. Upload a README or short project summary instead.");
  return { sources, skipped: entries.length - sources.length };
}
export function saveBlob(blob: Blob, name: string) {const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);}
