import { test,expect,type Page } from '@playwright/test';
import path from 'node:path';
const artifacts=path.resolve(process.env.PLAYWRIGHT_ARTIFACT_DIR??'test-results/artifacts');

async function enter(page:Page,room:{room_code:string,creator_token:string}){
 await page.addInitScript(r=>sessionStorage.setItem(`creator_token:${r.room_code}`,r.creator_token),room);
 await page.goto('/'+room.room_code);
 await page.getByRole('button',{name:'Chat humano',exact:true}).click();
 await page.getByLabel('E-mail',{exact:true}).fill('human@example.test');
 await page.getByLabel('Senha',{exact:true}).fill('test-password-only');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.getByLabel('Nome para exibição').fill('Maria QA');
 await page.getByRole('button',{name:'Participar',exact:true}).click();
 await expect(page.getByLabel('Sua mensagem',{exact:true})).toBeVisible();
}

test('HTTP agent lifecycle, aliases, read receipts and human isolation',async({request})=>{
 const created=await request.post('/api/v1/rooms',{data:{max_messages:10}});expect(created.status()).toBe(201);const room=await created.json();
 const second=await (await request.get(`/api/v1/${room.room_code}/agent-join`)).json();
 const sent=await request.post(`/api/v1/${room.room_code}/message`,{data:{token:room.agent_token,agent_name:'HTTP agent',content:'Mensagem do agente'}});expect(sent.status()).toBe(201);
 const read=await (await request.get(`/api/v1/${room.room_code}/read?token=${second.agent_token}`)).json();expect(read.messages).toHaveLength(1);expect(read.messages[0].read_by).toContain(second.agent_id);
 expect((await (await request.get(`/api/v1/${room.room_code}/read?token=${second.agent_token}`)).json()).messages).toEqual([]);
 expect((await request.post(`/api/human/rooms/${room.room_code}/messages`,{data:{content:'forged',client_message_id:crypto.randomUUID()}})).status()).toBe(401);
 expect((await request.post(`/api/v1/${room.room_code}/leave`,{data:{token:second.agent_token}})).status()).toBe(200);
});

test('human login, persisted chat, reload and uncertain-network retry',async({page,request})=>{
 const room=await (await request.post('/api/v1/rooms',{data:{max_messages:10}})).json();await enter(page,room);
 await page.getByLabel('Sua mensagem',{exact:true}).fill('Olá da participante humana');
 let committed=false;
 await page.route(`**/api/human/rooms/${room.room_code}/messages`,async route=>{if(!committed){committed=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Enviar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Tentar novamente',exact:true})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Chat humano',exact:true}).click();
 await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('Olá da participante humana');
 await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
 await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('');
 const transcript=await (await request.get(`/api/v1/${room.room_code}/transcript`)).json();expect(transcript.messages.filter((m:{content:string})=>m.content==='Olá da participante humana')).toHaveLength(1);
 await page.screenshot({path:path.join(artifacts,'human-chat-desktop.png'),fullPage:true});
});

test('first login shows the neutral join form when this account has no room session',async({page,request})=>{
 const room=await (await request.post('/api/v1/rooms',{data:{max_messages:10}})).json();
 await page.goto('/'+room.room_code);await page.getByRole('button',{name:'Chat humano',exact:true}).click();
 await page.getByLabel('E-mail',{exact:true}).fill('human@example.test');await page.getByLabel('Senha',{exact:true}).fill('test-password-only');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.getByText('Escolha seu nome e informe o convite para participar.')).toBeVisible();
 await expect(page.getByRole('region',{name:'Chat de participantes'}).getByRole('alert')).toHaveCount(0);
 await expect(page.getByLabel('Token de convite')).toBeVisible();
 await expect(page.getByRole('button',{name:'Participar',exact:true})).toBeDisabled();
});

test('human invitation fragment survives login, joins only its room and is removed from the URL',async({page,request})=>{
 await page.setViewportSize({width:390,height:844});
 const room=await (await request.post('/api/v1/rooms',{data:{max_messages:10}})).json();
 const authResponse=await request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{headers:{apikey:'local-e2e-anon-key'},data:{email:'human@example.test',password:'test-password-only'}});
 expect(authResponse.ok()).toBeTruthy();const auth=await authResponse.json();
 const inviteResponse=await request.post(`/api/human/rooms/${room.room_code}/invite`,{headers:{Authorization:`Bearer ${auth.access_token}`},data:{creator_token:room.creator_token}});
 expect(inviteResponse.status()).toBe(201);const invite=await inviteResponse.json();
 await page.goto(`/${room.room_code}?source=invite#human_invite=${invite.invite_token}`);
 await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible();
 await page.getByLabel('E-mail',{exact:true}).fill('human@example.test');await page.getByLabel('Senha',{exact:true}).fill('test-password-only');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.getByLabel('Token de convite')).toHaveValue(invite.invite_token);
 await expect(page.getByText('Escolha seu nome e informe o convite para participar.')).toBeVisible();
 await expect(page.getByRole('region',{name:'Chat de participantes'}).getByRole('alert')).toHaveCount(0);
 await expect(page).toHaveURL(new RegExp(`/${room.room_code}\\?source=invite$`));
 await page.getByLabel('Nome para exibição').fill('Convidada QA');
 await page.getByRole('button',{name:'Participar',exact:true}).click();
 await expect(page.getByLabel('Sua mensagem',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>sessionStorage.getItem(`creator_token:${location.pathname.slice(1)}`))).toBeNull();
});

test('pt-BR partials stay local, repeated final events deduplicate, final requires send',async({page,request})=>{
 await page.addInitScript(()=>{
  class Recognition {
   lang='';continuous=false;interimResults=false;onstart:(()=>void)|null=null;onresult:((e:unknown)=>void)|null=null;onend:(()=>void)|null=null;onerror:((e:unknown)=>void)|null=null;
   constructor(){(window as unknown as {qaSpeech:Recognition}).qaSpeech=this;}
   start(){this.onstart?.();}stop(){this.onend?.();}abort(){this.onend?.();}
  }
  (window as unknown as {SpeechRecognition:typeof Recognition}).SpeechRecognition=Recognition;
 });
 const room=await (await request.post('/api/v1/rooms',{data:{max_messages:10}})).json();await enter(page,room);
 await page.getByRole('button',{name:'Iniciar transcrição de voz'}).click();
 await page.evaluate(()=>{const speech=(window as unknown as {qaSpeech:{lang:string,onresult:(e:unknown)=>void}}).qaSpeech;if(speech.lang!=='pt-BR')throw Error('Wrong locale');speech.onresult({results:[Object.assign([{transcript:'fala parcial'}],{isFinal:false})]});});
 await expect(page.getByText('fala parcial',{exact:false})).toBeVisible();await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('');
 expect((await (await request.get(`/api/v1/${room.room_code}/transcript`)).json()).messages).toHaveLength(0);
 await page.evaluate(()=>{const speech=(window as unknown as {qaSpeech:{onresult:(e:unknown)=>void}}).qaSpeech;const event={results:[Object.assign([{transcript:'Bom dia'}],{isFinal:true})]};speech.onresult(event);speech.onresult(event);speech.onresult({results:[...event.results,Object.assign([{transcript:'Bom dia'}],{isFinal:true})]});});
 await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('Bom dia Bom dia');
 await page.getByRole('button',{name:'Parar transcrição'}).click();
 await page.getByRole('button',{name:'Enviar',exact:true}).click();await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('');
 const transcript=await (await request.get(`/api/v1/${room.room_code}/transcript`)).json();expect(transcript.messages).toHaveLength(1);expect(transcript.messages[0].content).toBe('Bom dia Bom dia');
 await page.screenshot({path:path.join(artifacts,'voice-transcription-desktop.png'),fullPage:true});
});

test('mobile typed fallback, microphone denial and locked-room enforcement',async({page,request})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{class DeniedRecognition{onerror:((e:unknown)=>void)|null=null;onend:(()=>void)|null=null;start(){this.onerror?.({error:'not-allowed'});this.onend?.();}stop(){}abort(){}};(window as unknown as {SpeechRecognition:typeof DeniedRecognition}).SpeechRecognition=DeniedRecognition;});
 const room=await (await request.post('/api/v1/rooms',{data:{max_messages:10}})).json();await enter(page,room);
 await page.getByRole('button',{name:'Iniciar transcrição de voz'}).click();await expect(page.getByText(/A permissão do microfone foi negada/)).toBeVisible();
 await page.getByLabel('Sua mensagem',{exact:true}).fill('Mensagem digitada após recusa');await page.getByRole('button',{name:'Enviar',exact:true}).click();await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('');
 await page.screenshot({path:path.join(artifacts,'human-chat-mobile.png'),fullPage:true});
 await request.post(`/api/v1/${room.room_code}/lock`,{data:{creator_token:room.creator_token}});
 await page.reload();await page.getByRole('button',{name:'Chat humano',exact:true}).click();await expect(page.getByLabel('Sua mensagem',{exact:true})).toBeDisabled();
});
