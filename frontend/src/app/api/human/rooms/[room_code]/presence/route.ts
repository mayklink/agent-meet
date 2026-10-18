import { handle, rpc } from '@/lib/server/human';
export const runtime='nodejs';
type Context={params:Promise<{room_code:string}>};
export async function GET(request:Request,{params}:Context){const {room_code}=await params;return handle(request,room_code,userId=>rpc('human_session',{p_room_code:room_code,p_user_id:userId,p_action:'presence'}));}
export async function POST(request:Request,{params}:Context){const {room_code}=await params;return handle(request,room_code,userId=>rpc('human_session',{p_room_code:room_code,p_user_id:userId,p_action:'heartbeat'}));}
