import { body, handle, HumanError, rpc, text } from '@/lib/server/human';
export const runtime='nodejs';
type Context={params:Promise<{room_code:string}>};
export async function POST(request:Request,{params}:Context){const {room_code}=await params;return handle(request,room_code,async userId=>{
 const data=await body(request);
 if(typeof data.client_message_id!=='string'|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.client_message_id))throw new HumanError(422,'invalid_request','Identificador inválido.');
 const source=data.source??'chat';if(source!=='chat'&&source!=='voice')throw new HumanError(422,'invalid_request','Origem inválida.');
 return rpc('human_message',{p_room_code:room_code,p_user_id:userId,p_client_message_id:data.client_message_id,p_content:text(data.content,1,4000),p_source:source});
 },201);}
