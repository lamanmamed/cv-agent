import {z} from "zod";
import {jsonResponse,readJSON} from "@/lib/api";
export async function POST(request:Request){
  try {
    const {key}=z.object({key:z.string().min(10).max(300)}).parse(await readJSON(request,1000));
    const res=await fetch("https://api.groq.com/openai/v1/models",{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
    if(!res.ok)return jsonResponse({error:res.status===401?"Groq rejected the API key.":"Groq could not verify the key. Try again later."},400);
    const data=await res.json() as {data?:{id:string}[]};
    if(!data.data?.some(m=>m.id==="openai/gpt-oss-20b"))return jsonResponse({error:"This Groq project does not have access to the CV analysis model."},400);
    return jsonResponse({connected:true,model:"openai/gpt-oss-20b"});
  }catch{return jsonResponse({error:"Could not verify the Groq key. Check the key or try again later."},400);}
}
