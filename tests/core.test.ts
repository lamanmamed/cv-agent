import {test} from "node:test";
import assert from "node:assert/strict";
import {applyDecision,parseCV,localAnalysis,validateSuggestions,keywordReport,SAMPLE_CV,SAMPLE_JOB,SAMPLE_EVIDENCE} from "../lib/cv.ts";
import {readEvidence,redactSecrets} from "../lib/import.ts";
import {readJSON} from "../lib/api.ts";
import JSZip from "jszip";

test("accept, reject and undo alter only the selected line",()=>{
  const blocks=parseCV(SAMPLE_CV),initial=localAnalysis(blocks,SAMPLE_JOB,SAMPLE_EVIDENCE).suggestions;
  assert.ok(initial.length>=3);
  const first=initial[0], accepted=applyDecision(blocks,initial,first.id,"accepted");
  assert.equal(accepted.blocks.find(b=>b.id===first.blockId)?.text,first.suggested);
  assert.deepEqual(accepted.blocks.filter(b=>b.id!==first.blockId),blocks.filter(b=>b.id!==first.blockId));
  const undo=applyDecision(accepted.blocks,accepted.suggestions,first.id,"pending"); assert.deepEqual(undo.blocks,blocks);
  const rejected=applyDecision(blocks,initial,first.id,"rejected");assert.deepEqual(rejected.blocks,blocks);
});
test("stale proposals cannot overwrite a manually changed line",()=>{
  const blocks=parseCV(SAMPLE_CV),suggestions=localAnalysis(blocks,SAMPLE_JOB,[]).suggestions,first=suggestions[0];
  const changed=blocks.map(b=>b.id===first.blockId?{...b,text:"Updated by the user"}:b);
  assert.throws(()=>applyDecision(changed,suggestions,first.id,"accepted"),/changed/);
});
test("citation, metric, skill, duplicate and original validation",()=>{
  const blocks=parseCV(SAMPLE_CV),s=localAnalysis(blocks,SAMPLE_JOB,[]).suggestions[0];
  assert.equal(validateSuggestions([s],blocks,[]).length,1);
  assert.throws(()=>validateSuggestions([{...s,citations:[{sourceId:s.blockId,quote:"Invented evidence."}]}],blocks,[]),/citation/);
  assert.throws(()=>validateSuggestions([{...s,suggested:s.suggested+" Improved results by 47%."}],blocks,[]),/number/);
  assert.throws(()=>validateSuggestions([{...s,suggested:s.suggested+" Deployed using Kubernetes."}],blocks,[]),/unsupported Kubernetes/);
  assert.throws(()=>validateSuggestions([s,s],blocks,[]),/duplicated/);
  assert.throws(()=>validateSuggestions([{...s,original:"Different text"}],blocks,[]),/target/);
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
