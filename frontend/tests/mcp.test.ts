import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { POST,GET,OPTIONS } from '@/app/mcp/route';
const store=vi.hoisted(()=>({getRoom:vi.fn(),registerAgent:vi.fn(),getRecentMessages:vi.fn(),sendMessage:vi.fn(),getAgentByToken:vi.fn(),getUnreadMessages:vi.fn(),markMessagesRead:vi.fn(),countActiveAgents:vi.fn(),leaveRoom:vi.fn()}));
vi.mock('@/lib/server/store',()=>({...store,ApiError:class extends Error{constructor(public status:number,public code:string,message:string){super(message);}}}));
describe('official MCP SDK and bounded HTTP transport',()=>{
 it('negotiates initialization, discovers exactly four tools, and dispatches to persistence directly',async()=>{
  store.getRoom.mockResolvedValue({state:'active',message_count:0});store.countActiveAgents.mockResolvedValue(0);store.registerAgent.mockResolvedValue({agent_id:'ag_test',agent_token:'at_test'});store.getRecentMessages.mockResolvedValue([]);
  const client=new Client({name:'meeting-protocol-test',version:'1.0.0'});
  const transport=new StreamableHTTPClientTransport(new URL('https://meeting.test/mcp'),{fetch:async(input,init)=>{const request=new Request(String(input),init as RequestInit);return request.method==='POST'?POST(request):GET(request);}});
  try{
   await client.connect(transport);
   expect((await client.listTools()).tools.map(t=>t.name).sort()).toEqual(['join_room','leave_room','read_messages','send_message']);
   const joined=await client.callTool({name:'join_room',arguments:{room_code:'aaa-bbbb-cccc'}});
   expect(joined.isError).not.toBe(true);expect(joined.structuredContent).toMatchObject({agent_id:'ag_test',agent_token:'at_test'});
   expect(store.registerAgent).toHaveBeenCalledWith('aaa-bbbb-cccc');
   const invalid=await client.callTool({name:'send_message',arguments:{room_code:'aaa-bbbb-cccc',agent_token:'at_test',agent_name:'Tester',content:'x'.repeat(4001)}});
   expect(invalid.isError).toBe(true);expect(store.sendMessage).not.toHaveBeenCalled();
   const unknown=await client.callTool({name:'missing_tool',arguments:{}});expect(unknown.isError).toBe(true);
  }finally{await client.close();}
 });
 it('rejects foreign origins, oversized actual bodies and unsupported GET streams',async()=>{
  expect((await POST(new Request('https://meeting.test/mcp',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'}))).status).toBe(403);
  expect((await OPTIONS(new Request('https://meeting.test/mcp',{headers:{Origin:'https://evil.test'}}))).status).toBe(403);
  expect((await POST(new Request('https://meeting.test/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(20001)}))).status).toBe(413);
  expect((await GET(new Request('https://meeting.test/mcp'))).status).toBe(405);
  const malformed=await POST(new Request('https://meeting.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:'{'}));expect(malformed.status).toBe(400);
 });
});
