export type Block = { id: string; text: string; section: string; heading: boolean };
export type Evidence = { id: string; name: string; text: string };
export type Citation = { sourceId: string; quote: string };
export type Suggestion = { id: string; blockId: string; original: string; suggested: string; reason: string; citations: Citation[]; status: "pending" | "accepted" | "rejected"; comment?: string; jobRequirement?:string };
export type CompanyInsight = {point:string;sourceId:string;quote:string};
export type ReviewComment = {id:string;blockId:string;kind:"question"|"observation"|"strength";text:string;origin:"ai"|"check"};
export type Analysis = { suggestions: Suggestion[]; gaps: string[]; mode: "local" | "groq"; insights?:CompanyInsight[];comments?:ReviewComment[];model?:string };
export type ResearchSource = {id:string;title:string;url:string;text:string};
export type CompanyResearch = {url:string;sources:ResearchSource[];failures:string[]};
export type ReviewHistory = Pick<Suggestion,"blockId"|"original"|"suggested"|"status">;
export function normalizedEdit(text:string) {return text.normalize("NFKC").replace(/\s+/g," ").trim().toLowerCase();}
export function isMeaningfulEdit(before:string,after:string) {return normalizedEdit(before)!==normalizedEdit(after);}
export function isEntryLine(text:string) {return /^(?:MSc|BSc|BEng|MEng|MA|BA|PhD|MBA|Master|Bachelor|Doctor)\b/i.test(text)|| /\b(?:university|college|institute)\b/i.test(text)&&!/[.!?]$/.test(text)||/\s[|·]\s/.test(text)||/\b(?:19|20)\d{2}\b.*(?:present|current|(?:19|20)\d{2})/i.test(text);}
export const HEADINGS = /^(summary|profile|professional summary|experience|work experience|employment|education|skills|technical skills|projects|research|publications|certifications|languages|interests|awards|volunteering|professional experience)\s*:?$/i;
export const SKILLS = ["Python", "SQL", "PyTorch", "TensorFlow", "scikit-learn", "React", "TypeScript", "JavaScript", "Java", "C++", "Rust", "Go", "R", "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Git", "GitHub", "PostgreSQL", "MongoDB", "Spark", "Pandas", "NumPy", "Tableau", "Power BI", "Excel", "machine learning", "deep learning", "NLP", "LLM", "transformer", "computer vision", "A/B testing", "data visualization", "statistics", "API", "ETL", "CI/CD", "MLOps"];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function containsTerm(text: string, term: string) { return new RegExp(`(^|[^a-z0-9])${escape(term)}(?=$|[^a-z0-9])`, "i").test(text); }
export function parseCV(text: string): Block[] {
  let section = "Profile";
  const lines:string[]=[];let separated=false;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line=raw.replace(/[\u00ad\u200b]/g,"").replace(/\s+/g," ").trim();
    if(!line){separated=true;continue;}
    const previous=lines[lines.length-1];
    if(previous&&!separated&&/^[•●▪\-*]\s*/.test(previous)&&!HEADINGS.test(line)&&! /^[•●▪\-*]\s*/.test(line)&&!isEntryLine(line)&&previous.length+line.length<1500) lines[lines.length-1]=previous+" "+line;
    else lines.push(line);
    separated=false;
  }
  return lines.map((text, i) => {
    const heading = HEADINGS.test(text); if (heading) section = text.replace(/:$/, "");
    return { id: `line-${i}`, text, section, heading };
  });
}
export function cvSources(blocks: Block[], evidence: Evidence[]): Evidence[] { return [...blocks.map(b => ({ id: b.id, name: `CV · ${b.section}`, text: b.text })), ...evidence]; }
export function keywordReport(blocks: Block[], job: string, evidence: Evidence[]) {
  const cv = blocks.map(b => b.text).join("\n"), work = evidence.map(e => e.text).join("\n");
  const requirements = SKILLS.filter(s => containsTerm(job, s));
  return { requirements, matched: requirements.filter(s => containsTerm(cv, s)), evidenceOnly: requirements.filter(s => !containsTerm(cv, s) && containsTerm(work, s)), missing: requirements.filter(s => !containsTerm(cv, s) && !containsTerm(work, s)) };
}
export function localAnalysis(blocks: Block[], job: string, evidence: Evidence[]): Analysis {
  return { suggestions: [], comments:reviewComments(blocks,job,evidence), gaps: keywordReport(blocks, job, evidence).missing, mode: "local" };
}
export function isURLOnly(text:string){return /^(?:https?:\/\/|www\.)\S+\/?$/i.test(text.trim());}
export function descriptionError(text:string){return isURLOnly(text)?"You pasted the wrong thing: this is a link. Paste it into Job link and press Read link.":text.trim().length<40?"Add the job description, including its requirements and responsibilities.":null;}
export function reviewComments(blocks:Block[],job:string,evidence:Evidence[],reviewed=false):ReviewComment[]{
  const report=keywordReport(blocks,job,evidence),comments:ReviewComment[]=[];
  const add=(id:string,blockId:string,text:string)=>comments.push({id,blockId,text,kind:"question",origin:"check"});
  if(report.evidenceOnly.length)add("check-evidence","",`${report.evidenceOnly.join(", ")} appears in project evidence but not the CV. Which parts did you personally implement? Confirm your contribution before adding it.`);
  if(report.missing.length)add("check-gap","",`The job mentions ${report.missing.slice(0,5).join(", ")}, but these are not documented in the CV or project evidence. Do you have relevant experience to add? If not, leave them out.`);
  const bullet=blocks.find(b=>/^[•●▪*-]/.test(b.text)&&!/[\d%]/.test(b.text));
  if(bullet)add("check-outcome",bullet.id,`For “${bullet.text.replace(/^[•●▪*-]\s*/,"").slice(0,180)}”, what result, comparison, or scope can you substantiate? A concrete outcome would make the contribution easier to assess; it does not have to be a number.`);
  if(!comments.length){const block=blocks.find(b=>!b.heading&&/experience|project|research/i.test(b.section));add("check-detail",block?.id||"",reviewed?"Your earlier decisions are retained. Which remaining achievement should we examine more closely for this role? Add a specific outcome or clarify your contribution to support another edit.":"Which achievement best demonstrates the responsibilities in this job? Add its outcome and your personal contribution if they are missing; I cannot infer them from a project name alone.");}
  return comments.slice(0,3);
}
export function validateSuggestions(items: unknown[], blocks: Block[], evidence: Evidence[]): Suggestion[] {
  const sources = cvSources(blocks, evidence), used = new Set<string>();
  return items.map((value, i) => {
    const item = value as Omit<Suggestion, "id" | "status">, block = blocks.find(b => b.id === item.blockId);
    if (!block || block.heading || block.text !== item.original || used.has(block.id)) throw new Error("The AI returned an invalid or duplicated CV target. Please try again.");
    if (typeof item.suggested !== "string" || !item.suggested.trim() || item.suggested.length > 1500 || !isMeaningfulEdit(item.original,item.suggested) || typeof item.reason !== "string") throw new Error("The AI returned an empty or cosmetic-only edit.");
    if (!Array.isArray(item.citations) || !item.citations.length) throw new Error("An edit has no source citation.");
    for (const citation of item.citations) {
      const source = sources.find(e => e.id === citation.sourceId);
      if (!source || typeof citation.quote !== "string" || citation.quote.trim().length < 8 || !source.text.includes(citation.quote)) throw new Error("An AI citation could not be found in your sources. The edit was blocked.");
    }
    const support = [block.text, ...item.citations.map(c => sources.find(s => s.id === c.sourceId)!.text)].join("\n");
    for (const skill of SKILLS) if (containsTerm(item.suggested, skill) && !containsTerm(support, skill)) throw new Error(`An unsupported ${skill} claim was blocked.`);
    const numbers: string[] = support.match(/\d+(?:[.,]\d+)*(?:%|\+)?/g) || [];
    for (const number of item.suggested.match(/\d+(?:[.,]\d+)*(?:%|\+)?/g) || []) if (!numbers.includes(number)) throw new Error("An unsupported number was blocked.");
    used.add(block.id); return { ...item, id: `edit-${i}`, status: "pending" as const };
  });
}
export function filterReviewedEdits(items:Suggestion[],history:ReviewHistory[]) {
  return items.filter(item=>!history.some(old=>old.blockId===item.blockId&&(old.status==="accepted"||old.status==="pending"||old.status==="rejected"&&normalizedEdit(old.original)===normalizedEdit(item.original))));
}
export function applyDecision(blocks: Block[], suggestions: Suggestion[], id: string, status: "accepted" | "rejected" | "pending") {
  const suggestion = suggestions.find(s => s.id === id); if (!suggestion) throw new Error("Suggestion not found.");
  const block = blocks.find(b => b.id === suggestion.blockId), expected = suggestion.status === "accepted" ? suggestion.suggested : suggestion.original;
  if (!block || block.text !== expected) throw new Error("This CV line changed. Analyze the updated CV before applying this edit.");
  return { blocks: blocks.map(b => b.id === suggestion.blockId ? { ...b, text: status === "accepted" ? suggestion.suggested : suggestion.original } : b), suggestions: suggestions.map(s => s.id === id ? { ...s, status } : s) };
}
export const SAMPLE_CV = `Avery Chen
Junior Data Scientist
avery@example.com · London, UK · github.com/avery-example
SUMMARY
Early-career data scientist with experience building machine learning models and explaining results to stakeholders.
EXPERIENCE
Data Science Intern · Northstar Analytics
June 2025 – September 2025
• Responsible for analyzing customer data using Python and SQL.
• Worked on building dashboards to help the product team understand customer retention.
• Utilized Pandas to clean and prepare datasets for weekly reporting.
PROJECTS
Patient outcome prediction · Academic project
• Worked on developing a machine learning model for predicting patient outcomes.
• Compared model performance and documented experiment results.
EDUCATION
MSc Data Science · Example University · 2025
TECHNICAL SKILLS
Python · SQL · Pandas · scikit-learn · Git`;
export const SAMPLE_JOB = `Junior Data Scientist
Join a healthcare analytics team building machine learning models.
Requirements: Python, SQL, PyTorch, statistics, and data visualization.
You will evaluate model performance, communicate findings, and collaborate with engineers.
Docker experience is a plus.`;
export const SAMPLE_EVIDENCE: Evidence[] = [{ id: "project-1", name: "patient-outcomes/README.md (sample)", text: "Patient outcome prediction. Implemented a binary classifier with PyTorch. Evaluated using ROC AUC across five cross-validation folds. Data processing used Python and Pandas. This was an academic project, not a deployed clinical tool." }];
