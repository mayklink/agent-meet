import { NextResponse } from 'next/server';
import { getAdmin } from './db';

export class HumanError extends Error {
 constructor(public status: number, public code: string, message: string) { super(message); }
}
const errors: Record<string,[number,string]> = {
 session_not_found:[404,'Escolha seu nome e use o convite para participar desta sala.'],
 room_not_found:[404,'Sala não encontrada.'], room_locked:[423,'A sala está encerrada.'], forbidden:[403,'Você não tem uma sessão ativa nesta sala.'],
 room_full:[409,'A sala atingiu o limite de participantes.'], invalid_request:[422,'Dados inválidos.'], idempotency_conflict:[409,'Este identificador já foi usado com outro conteúdo.'], rate_limited:[429,'Aguarde um segundo entre mensagens.'],
};
export function response(data: unknown, status=200) {
 return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin'}});
}
export async function authenticate(request: Request): Promise<string> {
 const origin=request.headers.get('origin');
 // Next.js can normalize request.url to an internal hostname behind a proxy.
 // Host retains the browser-facing authority; do not trust forwarded-host input.
 if (origin) {
  let matches=false;
  try {const parsed=new URL(origin);matches=['http:','https:'].includes(parsed.protocol)&&parsed.host===(request.headers.get('host')??new URL(request.url).host); }catch{}
  if(!matches) throw new HumanError(403,'origin_rejected','Origem não permitida.');
 }
 const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
 if (!token) throw new HumanError(401,'unauthorized','Entre na sua conta.');
 const {data,error}=await getAdmin().auth.getUser(token);
 if(error || !data.user || data.user.is_anonymous) throw new HumanError(401,'unauthorized','Sessão inválida ou expirada.');
 return data.user.id;
}
export async function body(request: Request): Promise<Record<string,unknown>> {
 if(!request.headers.get('content-type')?.startsWith('application/json')) throw new HumanError(415,'unsupported_media_type','Use JSON.');
 // Bound the actual stream, including requests without Content-Length.
 const reader=request.body?.getReader();
 if(!reader) throw new HumanError(422,'invalid_request','Dados inválidos.');
 let size=0; const chunks: Uint8Array[]=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>20000){await reader.cancel();throw new HumanError(413,'payload_too_large','Mensagem muito grande.');}chunks.push(value);}
 try { const data=JSON.parse(Buffer.concat(chunks).toString('utf8')); if(!data||Array.isArray(data)||typeof data!=='object')throw new Error();return data; }
 catch {throw new HumanError(422,'invalid_request','JSON inválido.');}
}
export function text(value:unknown,min:number,max:number): string {
 if(typeof value!=='string'||value.trim().length<min||value.length>max) throw new HumanError(422,'invalid_request','Texto inválido.');
 return value;
}
export async function rpc(name:string,args:Record<string,unknown>) {
 const {data,error}=await getAdmin().rpc(name,args);
 if(error){const code=error.message.match(/human:([a-z_]+)/)?.[1];if(code&&errors[code])throw new HumanError(errors[code][0],code,errors[code][1]);throw new Error('Human persistence unavailable');}
 return data;
}
export async function getHumanSession(roomCode:string,userId:string) {
 const {data,error}=await getAdmin().from('human_sessions').select('participant_id').eq('room_code',roomCode).eq('user_id',userId).maybeSingle();
 if(error)throw new Error('Human persistence unavailable');
 if(!data)throw new HumanError(404,'session_not_found',errors.session_not_found[1]);
 return rpc('human_session',{p_room_code:roomCode,p_user_id:userId,p_action:'get'});
}
export async function handle(request:Request,roomCode:string,action:(userId:string)=>Promise<unknown>,status=200) {
 try {
  if(!/^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(roomCode)) throw new HumanError(404,'room_not_found','Sala não encontrada.');
  return response(await action(await authenticate(request)),status);
 } catch(error) {
  if(error instanceof HumanError)return response({error:error.code,message:error.message},error.status);
  console.error('[human] request failed');
  return response({error:'service_unavailable',message:'Serviço temporariamente indisponível.'},503);
 }
}
