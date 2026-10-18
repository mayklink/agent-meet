import { test,expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
test('two official MCP clients join, send, read receipts, isolate rooms, leave and respect creator lock',async({request})=>{
 const room=await (await request.post('/api/v1/rooms',{data:{}})).json();
 const other=await (await request.post('/api/v1/rooms',{data:{}})).json();
 const first=new Client({name:'meeting-test-a',version:'1.0.0'}),second=new Client({name:'meeting-test-b',version:'1.0.0'});
 const call=async(client:Client,name:string,args:Record<string,unknown>)=>{const result=await client.callTool({name,arguments:args});return {result,data:result.structuredContent as Record<string,unknown>};};
 try{
  await first.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3100/mcp')));
  await second.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3100/mcp')));
  expect((await first.listTools()).tools).toHaveLength(4);
  const a=(await call(first,'join_room',{room_code:room.room_code})).data;
  const b=(await call(second,'join_room',{room_code:room.room_code})).data;
  expect(a.agent_token).not.toBe(b.agent_token);
  expect(JSON.stringify(a)).not.toContain(room.creator_token);
  const credentials={room_code:room.room_code,agent_token:a.agent_token};
  expect((await call(first,'send_message',{...credentials,agent_name:'MCP A',content:'MCP persisted message'})).result.isError).not.toBe(true);
  const read=await call(second,'read_messages',{room_code:room.room_code,agent_token:b.agent_token});
  expect(read.data.messages).toMatchObject([{content:'MCP persisted message',read_by:[b.agent_id]}]);
  expect((await call(second,'read_messages',{room_code:room.room_code,agent_token:b.agent_token})).data.messages).toEqual([]);
  expect((await call(first,'send_message',{...credentials,room_code:other.room_code,agent_name:'MCP A',content:'forbidden'})).result.isError).toBe(true);
  expect((await call(first,'leave_room',credentials)).data.status).toBe('left');
  expect((await call(first,'leave_room',credentials)).data.status).toBe('left');
  expect((await call(first,'send_message',{...credentials,agent_name:'MCP A',content:'after leave'})).result.isError).toBe(true);
  expect((await call(first,'read_messages',credentials)).result.isError).toBe(true);
  await request.post(`/api/v1/${room.room_code}/lock`,{data:{creator_token:room.creator_token}});
  expect((await call(second,'send_message',{room_code:room.room_code,agent_token:b.agent_token,agent_name:'MCP B',content:'closed'})).result.isError).toBe(true);
  expect((await call(second,'join_room',{room_code:room.room_code})).result.isError).toBe(true);
  expect((await (await request.get(`/api/v1/${room.room_code}/transcript`)).json()).messages).toHaveLength(1);
 }finally{await first.close();await second.close();}
});
