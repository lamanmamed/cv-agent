export const jsonResponse = (data: unknown, status = 200) => Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function readJSON(request: Request, maxBytes = 75000) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) throw new Error("Cross-origin requests are not accepted.");
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Error("Send JSON data.");
  if (Number(request.headers.get("content-length")) > maxBytes) throw new Error("Request is too large. Use shorter source text.");
  const reader = request.body?.getReader(); if (!reader) throw new Error("No request body.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const {done,value} = await reader.read(); if(done) break; length += value.byteLength;
    if(length>maxBytes) {await reader.cancel(); throw new Error("Request is too large. Use shorter source text.");} chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0; for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
  try {return JSON.parse(new TextDecoder().decode(bytes));} catch {throw new Error("Invalid JSON request.");}
}
export async function boundedFetchText(url: string, headers: Record<string,string> = {}, limit = 500000,timeoutMs=15000) {
  const response = await fetch(url,{headers,redirect:"error",signal:AbortSignal.timeout(timeoutMs)});
  if(response.status === 429 || response.status === 403) throw new Error("This service is rate-limiting requests. Paste the text instead or try later.");
  if(!response.ok) throw new Error("The link could not be read. Check that it is public and still available, or paste the text instead.");
  if(Number(response.headers.get("content-length"))>limit) throw new Error("The source is too large. Paste just the relevant text.");
  const reader = response.body?.getReader(); if(!reader) throw new Error("The source returned no text.");
  let length = 0, text = ""; const decoder = new TextDecoder();
  while(true) {const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error("The source is too large. Paste just the relevant text.");}text+=decoder.decode(value,{stream:true});}
  return text+decoder.decode();
}
