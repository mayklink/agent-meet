import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMeetingMcpServer } from '@/lib/server/mcp';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX_BODY=20000;
function allowed(request:Request) {
 const origin=request.headers.get('origin');
 if(!origin)return true;
 try {
  const url=new URL(origin);
  if(!['http:','https:'].includes(url.protocol)||url.origin!==origin)return false;
  if(url.host===(request.headers.get('host')??new URL(request.url).host))return true;
  return (process.env.MCP_ALLOWED_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean).includes(origin);
 } catch {return false;}
}
function decorate(response:Response,request:Request) {
 response.headers.set('Cache-Control','no-store');
 response.headers.set('Vary','Origin');
 const origin=request.headers.get('origin');
 if(origin&&allowed(request)){
  response.headers.set('Access-Control-Allow-Origin',origin);
  response.headers.set('Access-Control-Allow-Methods','POST, GET, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers','Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id');
 }
 return response;
}
export async function POST(request:Request) {
 if(!allowed(request))return new Response('Forbidden origin',{status:403});
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return decorate(new Response('Expected application/json',{status:415}),request);
 // Bound the actual stream rather than trusting Content-Length.
 const reader=request.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
 if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();return decorate(new Response('Request too large',{status:413}),request);}chunks.push(value);}
 const bounded=new Request(request.url,{method:'POST',headers:request.headers,body:Buffer.concat(chunks)});
 const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true});
 const server=createMeetingMcpServer();
 try {await server.connect(transport);return decorate(await transport.handleRequest(bounded),request);}
 catch {return decorate(Response.json({jsonrpc:'2.0',id:null,error:{code:-32603,message:'MCP service unavailable'}},{status:500}),request);}
 finally {await server.close();}
}
export async function GET(request:Request) {
 if(!allowed(request))return new Response('Forbidden origin',{status:403});
 return decorate(new Response(null,{status:405,headers:{Allow:'POST, OPTIONS'}}),request);
}
export const DELETE=GET;
export async function OPTIONS(request:Request) {
 if(!allowed(request))return new Response('Forbidden origin',{status:403});
 return decorate(new Response(null,{status:204}),request);
}
