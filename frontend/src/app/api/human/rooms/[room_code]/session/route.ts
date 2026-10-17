import { body, handle, rpc, text } from '@/lib/server/human';
export const runtime='nodejs';
type Context={params:Promise<{room_code:string}>};
export async function POST(request:Request,{params}:Context){const {room_code}=await params;return handle(request,room_code,async userId=>{const data=await body(request);return rpc('human_join',{p_room_code:room_code,p_user_id:userId,p_display_name:text(data.display_name,1,100),p_creator_token:data.creator_token==null?null:text(data.creator_token,1,128)});});}
export async function GET(request:Request,{params}:Context){const {room_code}=await params;return handle(request,room_code,userId=>rpc('human_session',{p_room_code:room_code,p_user_id:userId,p_action:'get'}));}
export async function DELETE(request:Request,{params}:Context){const {room_code}=await params;return handle(request,room_code,userId=>rpc('human_session',{p_room_code:room_code,p_user_id:userId,p_action:'leave'}));}
