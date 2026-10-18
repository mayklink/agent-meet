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
 const membershipRefresh=page.waitForResponse(response=>response.url().includes(`/api/human/rooms/${room.room_code}/session`)&&response.status()===200);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await membershipRefresh;
 await expect(page.getByLabel('Sua mensagem',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Participar',exact:true})).toHaveCount(0);
 await page.getByLabel('Sua mensagem',{exact:true}).fill('Olá da participante humana');
 let committed=false;
 await page.route(`**/api/human/rooms/${room.room_code}/messages`,async route=>{if(!committed){committed=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Enviar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Tentar novamente',exact:true})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Chat humano',exact:true}).click();
 await expect(page.getByRole('button',{name:'Tentar novamente',exact:true})).toBeVisible();
 await expect(page.getByText('A mensagem “Olá da participante humana” não teve confirmação. A nova tentativa usa o mesmo identificador.')).toBeVisible();
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

test('signed-in nonmember accepts an invitation fragment on the already-open room',async({page,request})=>{
 const room=await (await request.post('/api/v1/rooms',{data:{max_messages:10}})).json();
 await page.goto('/'+room.room_code);await page.getByRole('button',{name:'Chat humano',exact:true}).click();
 await page.getByLabel('E-mail',{exact:true}).fill('human@example.test');await page.getByLabel('Senha',{exact:true}).fill('test-password-only');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.getByText('Escolha seu nome e informe o convite para participar.')).toBeVisible();
 const authResponse=await request.post('http://127.0.0.1:54329/auth/v1/token?grant_type=password',{headers:{apikey:'local-e2e-anon-key'},data:{email:'human@example.test',password:'test-password-only'}});
 expect(authResponse.ok()).toBeTruthy();const auth=await authResponse.json();
 const inviteResponse=await request.post(`/api/human/rooms/${room.room_code}/invite`,{headers:{Authorization:`Bearer ${auth.access_token}`},data:{creator_token:room.creator_token}});
 expect(inviteResponse.status()).toBe(201);const invite=await inviteResponse.json();
 await page.evaluate(token=>{window.location.hash=`human_invite=${token}`;},invite.invite_token);
 await expect(page.getByLabel('Token de convite')).toHaveValue(invite.invite_token);
 await expect(page.getByRole('region',{name:'Chat de participantes'})).toBeVisible();
 await expect(page).toHaveURL(new RegExp(`/${room.room_code}$`));
});

test('pt-BR hands-free voice sends finals after silence, keeps typed draft separate and mutes late callbacks',async({page,request})=>{
 await page.addInitScript(()=>{
  class Recognition {
   lang='';continuous=false;interimResults=false;onstart:(()=>void)|null=null;onresult:((e:unknown)=>void)|null=null;onend:(()=>void)|null=null;onerror:((e:unknown)=>void)|null=null;
   constructor(){const target=window as unknown as {qaSpeech:Recognition,qaSpeechRuns:Recognition[]};target.qaSpeech=this;target.qaSpeechRuns??=[];target.qaSpeechRuns.push(this);}
   start(){this.onstart?.();}stop(){this.onend?.();}abort(){this.onend?.();}
  }
  (window as unknown as {SpeechRecognition:typeof Recognition}).SpeechRecognition=Recognition;
 });
 const room=await (await request.post('/api/v1/rooms',{data:{max_messages:10}})).json();await enter(page,room);
 const voiceRequests:{content:string,client_message_id:string,source:string}[]=[];let firstVoiceCommitted=false;
 await page.route(`**/api/human/rooms/${room.room_code}/messages`,async route=>{
  voiceRequests.push(JSON.parse(route.request().postData()??'{}'));
  if(!firstVoiceCommitted){firstVoiceCommitted=true;await route.fetch();await route.abort('failed');}
  else await route.continue();
 });
 await page.getByLabel('Sua mensagem',{exact:true}).fill('Rascunho digitado fica separado');
 await page.getByRole('button',{name:'Ativar microfone',exact:true}).click();
 await expect(page.getByRole('button',{name:'Mutar microfone',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('status').filter({hasText:'Ouvindo'})).toBeVisible();
 await page.evaluate(()=>{const speech=(window as unknown as {qaSpeech:{lang:string,continuous:boolean,interimResults:boolean}}).qaSpeech;if(speech.lang!=='pt-BR'||!speech.continuous||!speech.interimResults)throw Error('Wrong recognition configuration');});
 await page.screenshot({path:path.join(artifacts,'human-chat-desktop-composer.png'),fullPage:true});
 await page.evaluate(()=>{const speech=(window as unknown as {qaSpeech:{onresult:(e:unknown)=>void}}).qaSpeech;speech.onresult({results:[Object.assign([{transcript:'Bom dia'}],{isFinal:true})]});speech.onresult({results:[Object.assign([{transcript:'Bom dia'}],{isFinal:true})]});speech.onresult({results:[Object.assign([{transcript:'Bom dia'}],{isFinal:true}),Object.assign([{transcript:'Bom dia'}],{isFinal:true})]});});
 await page.waitForTimeout(650);
 await page.evaluate(()=>{const speech=(window as unknown as {qaSpeech:{onresult:(e:unknown)=>void}}).qaSpeech;speech.onresult({results:[Object.assign([{transcript:'Bom dia'}],{isFinal:true}),Object.assign([{transcript:'Bom dia'}],{isFinal:true}),Object.assign([{transcript:'continua falando'}],{isFinal:false})]});});
 await expect(page.getByText('Prévia, ainda não enviada: continua falando',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('Rascunho digitado fica separado');
 await page.waitForTimeout(700);
 expect((await (await request.get(`/api/v1/${room.room_code}/transcript`)).json()).messages).toHaveLength(0);
 await expect(page.getByRole('button',{name:'Tentar novamente',exact:true})).toBeVisible();
 expect(voiceRequests).toHaveLength(1);expect(voiceRequests[0]).toMatchObject({content:'Bom dia Bom dia',source:'voice'});
 const uncertainMessageId=voiceRequests[0].client_message_id;expect(uncertainMessageId).toMatch(/^[0-9a-f-]{36}$/i);
 await page.waitForTimeout(1400);
 expect(voiceRequests).toHaveLength(1);
 expect((await (await request.get(`/api/v1/${room.room_code}/transcript`)).json()).messages).toHaveLength(1);
 await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
 await expect.poll(()=>voiceRequests.length,{timeout:5000}).toBe(2);
 expect(voiceRequests[1].client_message_id).toBe(uncertainMessageId);
 await expect.poll(async()=>{const transcript=await (await request.get(`/api/v1/${room.room_code}/transcript`)).json();return transcript.messages.length;},{timeout:5000}).toBe(1);
 let transcript=await (await request.get(`/api/v1/${room.room_code}/transcript`)).json();expect(transcript.messages[0].content).toBe('Bom dia Bom dia');
 await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('Rascunho digitado fica separado');
 await expect.poll(()=>page.evaluate(()=>((window as unknown as {qaSpeechRuns:unknown[]}).qaSpeechRuns.length))).toBeGreaterThan(1);
 const runningBeforeMute=await page.evaluate(()=>((window as unknown as {qaSpeechRuns:unknown[]}).qaSpeechRuns.length-1));
 await page.getByRole('button',{name:'Mutar microfone',exact:true}).click();
 await expect(page.getByRole('button',{name:'Desmutar microfone',exact:true})).toHaveAttribute('aria-pressed','false');
 await page.evaluate((index)=>{const run=(window as unknown as {qaSpeechRuns:{onresult:((e:unknown)=>void)|null}[]}).qaSpeechRuns[index];run.onresult?.({results:[Object.assign([{transcript:'fala tardia que não pode sair'}],{isFinal:true})]});},runningBeforeMute);
 await page.waitForTimeout(1400);
 transcript=await (await request.get(`/api/v1/${room.room_code}/transcript`)).json();expect(transcript.messages).toHaveLength(1);
 await page.getByRole('button',{name:'Desmutar microfone',exact:true}).click();
 await page.evaluate(()=>{const speech=(window as unknown as {qaSpeech:{onresult:(e:unknown)=>void}}).qaSpeech;speech.onresult({results:[Object.assign([{transcript:'Segunda fala'}],{isFinal:true})]});});
 await expect.poll(async()=>{const latest=await (await request.get(`/api/v1/${room.room_code}/transcript`)).json();return latest.messages.length;},{timeout:5000}).toBe(2);
 transcript=await (await request.get(`/api/v1/${room.room_code}/transcript`)).json();expect(transcript.messages[1].content).toBe('Segunda fala');
 await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('Rascunho digitado fica separado');
});

test('mobile typed fallback, microphone denial and locked-room enforcement',async({page,request})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{class DeniedRecognition{onerror:((e:unknown)=>void)|null=null;onend:(()=>void)|null=null;start(){this.onerror?.({error:'not-allowed'});this.onend?.();}stop(){}abort(){}};(window as unknown as {SpeechRecognition:typeof DeniedRecognition}).SpeechRecognition=DeniedRecognition;});
 const room=await (await request.post('/api/v1/rooms',{data:{max_messages:10}})).json();await enter(page,room);
 await page.getByRole('button',{name:'Ativar microfone'}).click();await expect(page.getByText(/A permissão do microfone foi negada/)).toBeVisible();
 await page.getByLabel('Sua mensagem',{exact:true}).fill('Mensagem digitada após recusa');
 await page.screenshot({path:path.join(artifacts,'human-chat-mobile-composer.png'),fullPage:true});
 await page.getByRole('button',{name:'Enviar',exact:true}).click();await expect(page.getByLabel('Sua mensagem',{exact:true})).toHaveValue('');
 await request.post(`/api/v1/${room.room_code}/lock`,{data:{creator_token:room.creator_token}});
 await page.reload();await page.getByRole('button',{name:'Chat humano',exact:true}).click();await expect(page.getByLabel('Sua mensagem',{exact:true})).toBeDisabled();
});
