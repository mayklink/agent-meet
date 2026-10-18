import {body,handle,rpc,text} from '@/lib/server/human';
export const runtime='nodejs';
type Context={params:Promise<{room_code:string}>};
export async function POST(request:Request,{params}:Context){const {room_code}=await params;return handle(request,room_code,async()=>{const data=await body(request);return rpc('human_create_invite',{p_room_code:room_code,p_creator_token:text(data.creator_token,1,128)});},201);}
