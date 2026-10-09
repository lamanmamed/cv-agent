import type {Block} from "./cv.ts";

/** Preserve byte-for-byte originals, and never silently turn a designed CV into a generic re-layout. */
export function sameDocumentContent(original:Pick<Block,"id"|"text">[], current:Pick<Block,"id"|"text">[]):boolean {
  return original.length===current.length&&original.every((block,i)=>block.id===current[i].id&&block.text===current[i].text);
}

export function layoutSafeExports(format:string|null,unchanged:boolean):{docx:boolean;pdf:boolean} {
  if(format==="docx")return {docx:true,pdf:false};
  if(format==="pdf")return {docx:false,pdf:unchanged};
  // Text-only input has no source document layout to preserve.
  return {docx:true,pdf:true};
}
