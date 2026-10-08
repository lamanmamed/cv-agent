import {z} from "zod";
import {jsonResponse,readJSON} from "../../../lib/api.ts";
import {GroqError,groqJSON,GROQ_MODEL,reviewKey,savedGroqKey} from "../../../lib/groq.ts";
import {outputJSON} from "../../../lib/ai-review-schema.ts";
export function GET(){return jsonResponse({configured:!!savedGroqKey()});}
export async function POST(request:Request){
  try {
    const parsed=z.object({key:z.string().trim().max(300).optional()}).safeParse(await readJSON(request,1000));
    if(!parsed.success)return jsonResponse({error:"Enter a valid Groq API key."},400);
    // Exercise the same model, parameters and schema as analysis, using synthetic data only.
    const key=reviewKey(parsed.data.key);if(key.length<10)return jsonResponse({error:"Connect a Groq API key in AI settings.",code:"GROQ_NOT_CONFIGURED"},400);
    const expected={suggestions:[],comments:[{blockId:"",kind:"observation",text:"AI connection test completed."}],insights:[]};
    const output=await groqJSON(key,{schema:outputJSON,maxCompletionTokens:800,timeoutMs:20000,messages:[{role:"system",content:"This is a connection test. Return the exact JSON supplied by the user without any additions."},{role:"user",content:JSON.stringify(expected)}]});
    const verified=z.object({suggestions:z.array(z.unknown()).length(0),comments:z.array(z.object({blockId:z.literal(""),kind:z.literal("observation"),text:z.literal("AI connection test completed.")})).length(1),insights:z.array(z.unknown()).length(0)}).safeParse(output);
    if(!verified.success)throw new GroqError("Groq responded, but the structured generation test failed. Try connecting again.","GROQ_INVALID_REVIEW");
    return jsonResponse({connected:true,model:GROQ_MODEL});
  }catch(error){
    if(error instanceof GroqError)return jsonResponse({error:error.message,code:error.code,retryAfter:error.retryAfter},error.status);
    return jsonResponse({error:"The connection request could not be read. Check the key and try again."},400);
  }
}
