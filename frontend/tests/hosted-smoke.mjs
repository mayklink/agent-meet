// Run explicitly against an authorized staging deployment. Never uses production secrets.
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
const config=JSON.parse(await readFile(process.env.STAGING_QA_CONFIG,'utf8'));
const output=path.resolve(process.env.PLAYWRIGHT_ARTIFACT_DIR??'test-results/artifacts');
await mkdir(output,{recursive:true});
const report={baseUrl:config.baseUrl,checks:[],rooms:[],startedAt:new Date().toISOString()};
function check(name,ok){report.checks.push({name,passed:Boolean(ok)});if(!ok)throw Error('Failed: '+name);}
const browser=await chromium.launch();const context=await browser.newContext();const page=await context.newPage();
const publicClient=createClient(config.supabaseUrl,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
let channel;
try{
 await page.goto(config.accessUrl,{waitUntil:'networkidle'});
 console.log('Staging access resolved to '+new URL(page.url()).origin+new URL(page.url()).pathname);
 const api=context.request;
 const health=await api.get(config.baseUrl+'/api/v1/health');
 if(!health.headers()['content-type']?.includes('application/json'))throw Error(`Health returned ${health.status()} (${health.headers()['content-type']}) at ${new URL(health.url()).origin+new URL(health.url()).pathname}`);
 check('deployed health',health.status()===200&&(await health.json()).status==='ok');
 const created=await api.post(config.baseUrl+'/api/v1/rooms',{data:{max_messages:10}});check('deployed room create',created.status()===201);const room=await created.json();report.rooms.push(room.room_code);
 const second=await api.get(`${config.baseUrl}/api/v1/${room.room_code}/agent-join`);check('agent joins hosted API',second.status()===200);const agent=await second.json();
 await page.goto(config.baseUrl+'/'+room.room_code);
 await page.evaluate(r=>sessionStorage.setItem('creator_token:'+r.room_code,r.creator_token),room);await page.reload();
 await page.getByRole('button',{name:'Chat humano',exact:true}).click();
 await page.getByLabel('E-mail',{exact:true}).fill(config.email);await page.getByLabel('Senha',{exact:true}).fill(config.password);
 const authResult=page.waitForResponse(r=>r.url().includes('/auth/v1/token'));
 await page.getByRole('button',{name:'Entrar',exact:true}).click();const authResponse=await authResult;check('real Supabase Auth password login',authResponse.status()===200);const auth=await authResponse.json();
 await page.getByLabel('Nome para exibição').fill('Participante QA');await page.getByRole('button',{name:'Participar',exact:true}).click();
 await page.getByLabel('Sua mensagem',{exact:true}).waitFor();check('real Auth human membership',true);
 await page.getByLabel('Sua mensagem',{exact:true}).fill('Mensagem humana de homologação');await page.getByRole('button',{name:'Enviar',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#human-message')?.value==='');
 const transcript=await (await api.get(`${config.baseUrl}/api/v1/${room.room_code}/transcript`)).json();check('human message persisted in hosted transcript',transcript.messages.filter(m=>m.content==='Mensagem humana de homologação').length===1);
 const readResponse=await api.get(`${config.baseUrl}/api/v1/${room.room_code}/read?token=${agent.agent_token}`);
 if(!readResponse.headers()['content-type']?.includes('application/json'))throw Error(`Agent read returned status ${readResponse.status()} (${readResponse.headers()['content-type']})`);
 const read=await readResponse.json();check('agent reads human message and receipt',read.messages?.some(m=>m.content==='Mensagem humana de homologação'&&m.read_by.includes(agent.agent_id)));
 const otherRoom=await (await api.post(config.baseUrl+'/api/v1/rooms',{data:{max_messages:10}})).json();report.rooms.push(otherRoom.room_code);
 const forbidden=await api.post(`${config.baseUrl}/api/human/rooms/${otherRoom.room_code}/messages`,{headers:{Authorization:'Bearer '+auth.access_token},data:{client_message_id:crypto.randomUUID(),content:'Forbidden'}});check('verified user cannot write another room',forbidden.status()===403);
 const spoof=await api.post(`${config.baseUrl}/api/human/rooms/${room.room_code}/presence`,{headers:{Authorization:'Bearer '+auth.access_token,Origin:'https://evil.example'},data:{}});check('cross-origin write rejected in hosted proxy',spoof.status()===403);
 const presence=await api.get(`${config.baseUrl}/api/human/rooms/${room.room_code}/presence`,{headers:{Authorization:'Bearer '+auth.access_token}});check('scoped server-backed presence',presence.status()===200&&(await presence.json()).participants.some(p=>p.display_name==='Participante QA'&&p.online));
 const tokenProbe=await publicClient.from('rooms').select('creator_token').eq('room_code',room.room_code);check('public Data API cannot read creator credentials',Boolean(tokenProbe.error));
 const rpcProbe=await publicClient.rpc('send_message',{p_room_code:room.room_code,p_agent_id:agent.agent_id,p_agent_name:'Forged',p_content:'Forbidden'});check('anonymous cannot bypass HTTP through RPC',Boolean(rpcProbe.error));
 let resolveMessage;const delivered=new Promise(resolve=>{resolveMessage=resolve;});
 const streamTimeout=setTimeout(()=>resolveMessage(null),20000);
 channel=publicClient.channel('hosted-qa:'+room.room_code).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'room_code=eq.'+room.room_code},payload=>{if(payload.new.content==='Realtime verified message')resolveMessage(payload.new);});
 const subscribed=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),20000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve(true);}else if(status==='CHANNEL_ERROR'){clearTimeout(timer);resolve(false);}});});
 check('real Supabase Realtime subscription',subscribed);
 const send=await api.post(`${config.baseUrl}/api/v1/${room.room_code}/message`,{data:{agent_token:agent.agent_token,agent_name:'HTTP QA',content:'Realtime verified message'}});check('hosted agent message write',send.status()===201);
 const event=await delivered;clearTimeout(streamTimeout);check('real Supabase Realtime delivery',event&&event.room_code===room.room_code);
 await page.getByText('Realtime verified message',{exact:true}).waitFor();check('deployed browser transcript reconciles realtime',true);
 await page.getByRole('button',{name:'Gerar convite humano',exact:true}).click();await page.getByLabel('Convite para compartilhar',{exact:true}).waitFor();check('creator generates scoped human invitation',true);
 await page.screenshot({path:path.join(output,'hosted-human-chat.png'),fullPage:true,mask:[page.getByLabel('Convite para compartilhar',{exact:true})]});
 const session=await (await api.get(`${config.baseUrl}/api/human/rooms/${room.room_code}/session`,{headers:{Authorization:'Bearer '+auth.access_token}})).json();
 const kick=await api.post(`${config.baseUrl}/api/v1/${room.room_code}/kick`,{data:{creator_token:room.creator_token,agent_id:session.participant_id}});check('creator kicks human through existing contract',kick.status()===200);
 const afterKick=await api.post(`${config.baseUrl}/api/human/rooms/${room.room_code}/messages`,{headers:{Authorization:'Bearer '+auth.access_token},data:{client_message_id:crypto.randomUUID(),content:'After kick'}});check('kick immediately revokes human writes',afterKick.status()===403);
 report.success=true;
}catch(error){report.success=false;report.failure=error.message;await page.screenshot({path:path.join(output,'hosted-failure.png'),fullPage:true}).catch(()=>{});}
finally{report.completedAt=new Date().toISOString();if(channel)await publicClient.removeChannel(channel);await browser.close();await writeFile(path.join(output,'hosted-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
if(!report.success)process.exitCode=1;
