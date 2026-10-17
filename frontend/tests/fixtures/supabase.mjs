// Test-only HTTP stand-in for GoTrue/PostgREST; PostgreSQL functions execute in PGlite.
// This is never imported by the application or deployed as an application route.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
for(const name of ['migration.sql','human-participation.sql','human-security.sql'])await db.exec(readFileSync(new URL('../../supabase/'+name,import.meta.url),'utf8').replace(/^ALTER PUBLICATION .*$/gm,''));
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'human@example.test',is_anonymous:false,app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const jwt=[{alg:'HS256',typ:'JWT'},{sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'test-signature'].map((v,i)=>i===2?v:Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const allowedTables={rooms:['id','room_code','creator_token','state','max_messages','message_count','lock_reason','locked_at','first_message_at','last_activity_at','created_at'],agents:['id','agent_id','agent_token','room_code','agent_name','status','created_at','activated_at','left_at'],messages:['id','room_code','agent_id','agent_name','content','room_seq','read_by','created_at']};
const allowedRpc=new Set(['activate_agent','send_message','mark_messages_read','human_join','human_message','human_session','human_create_invite']);
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',req.headers.origin??'*');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept,range,range-unit');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,HEAD,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
 const url=new URL(req.url,'http://127.0.0.1:54329');
 const reply=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(req.method==='HEAD'?'':JSON.stringify(data));};
 try {
  let raw='';for await(const chunk of req)raw+=chunk;
  const data=raw?JSON.parse(raw):{};
  if(url.pathname==='/health')return reply(200,{ready:true});
  if(url.pathname.startsWith('/auth/v1/')){
   if(url.pathname.endsWith('/token')){
    if(data.email!=='human@example.test'||data.password!=='test-password-only')return reply(400,{msg:'Invalid login credentials'});
    return reply(200,{access_token:jwt,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'test-refresh-token',user});
   }
   if(url.pathname.endsWith('/user'))return req.headers.authorization===`Bearer ${jwt}`?reply(200,user):reply(401,{msg:'Invalid JWT'});
   if(url.pathname.endsWith('/logout'))return reply(200,{});
  }
  if(req.headers.apikey!=='local-e2e-service-key')return reply(403,{message:'Fixture only accepts server credentials for data access'});
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1);if(!allowedRpc.has(name))return reply(404,{});
   const args=Object.keys(data);if(args.some(k=>!/^p_[a-z_]+$/.test(k)))return reply(400,{});
   const q=`SELECT public.${name}(${args.map((k,i)=>`${k}=>$${i+1}`).join(',')}) AS result`;
   const r=await db.query(q,Object.values(data));
   return reply(200,name==='mark_messages_read'?r.rows.map(x=>x.result):r.rows[0]?.result??null);
  }
  const table=url.pathname.split('/').at(-1),cols=allowedTables[table];if(!cols)return reply(404,{});
  const column=(c)=>{if(!cols.includes(c))throw Error('Invalid fixture column');return '"'+c+'"';};
  const values=[];const bind=(v)=>{values.push(v);return '$'+values.length;};
  const where=[];
  for(const [key,val] of url.searchParams){if(['select','order','limit','offset'].includes(key))continue;const [op,...rest]=val.split('.');const v=rest.join('.');if(op==='eq')where.push(`${column(key)}=${bind(v)}`);else if(op==='neq')where.push(`${column(key)}<>${bind(v)}`);else if(op==='not'&&v.startsWith('cs.'))where.push(`NOT (${column(key)} @> ${bind(v.slice(3))}::varchar[])`);else throw Error('Unsupported fixture operator');}
  const filter=where.length?' WHERE '+where.join(' AND '):'';
  const selected=(url.searchParams.get('select')??'*')==='*'?'*':url.searchParams.get('select').split(',').map(column).join(',');
  let sql;
  if(req.method==='POST'){const keys=Object.keys(data);sql=`INSERT INTO public.${table}(${keys.map(column).join(',')}) VALUES(${keys.map(k=>bind(data[k])).join(',')}) RETURNING ${selected}`;}
  else if(req.method==='PATCH'){sql=`UPDATE public.${table} SET ${Object.keys(data).map(k=>`${column(k)}=${bind(data[k])}`).join(',')}${filter} RETURNING ${selected}`;}
  else{sql=`SELECT ${selected} FROM public.${table}${filter}`;if(url.searchParams.has('order')){const [c,d]=url.searchParams.get('order').split('.');sql+=` ORDER BY ${column(c)} ${d==='desc'?'DESC':'ASC'}`;}if(url.searchParams.has('limit'))sql+=` LIMIT ${bind(Number(url.searchParams.get('limit')))}`;if(url.searchParams.has('offset'))sql+=` OFFSET ${bind(Number(url.searchParams.get('offset')))}`;}
  const result=await db.query(sql,values);
  const headers={'Content-Range':`0-${Math.max(0,result.rows.length-1)}/${result.rows.length}`};
  if(req.headers.accept?.includes('application/vnd.pgrst.object+json'))return reply(result.rows.length===1?200:406,result.rows.length===1?result.rows[0]:{code:'PGRST116',details:'The result contains 0 rows'},headers);
  return reply(req.method==='POST'?201:200,result.rows,headers);
 }catch(error){reply(400,{message:error.message,code:'P0001'});}
});
server.listen(54329,'127.0.0.1',()=>console.log('Test Supabase HTTP fixture ready (Auth/PostgREST emulated; no Realtime).'));
process.on('SIGTERM',()=>server.close(async()=>{await db.close();process.exit(0);}));
