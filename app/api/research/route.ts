import {z} from "zod";
import {jsonResponse,readJSON} from "@/lib/api";
import {researchCompany} from "@/lib/web-research";
export async function POST(request:Request){
  try {const {url}=z.object({url:z.string().url().max(2000)}).parse(await readJSON(request,4000));return jsonResponse(await researchCompany(url));}
  catch(error){return jsonResponse({error:error instanceof z.ZodError?"Enter the company's public website URL.":error instanceof Error?error.message:"Company research could not complete."},400);}
}
