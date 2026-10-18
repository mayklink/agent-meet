import { afterAll, beforeAll, expect, it } from 'vitest';
import { database } from './database';
import type { PGlite } from '@electric-sql/pglite';
let db:PGlite;
beforeAll(async()=>{db=await database();},30000);
afterAll(async()=>{await db?.close();});
it('retains history past 500 and 1000, accepts humans, and stops only when explicitly locked',async()=>{
 await db.exec("INSERT INTO rooms(room_code,creator_token) VALUES('uuu-uuuu-uuuu','creator-unlimited'); INSERT INTO agents(agent_id,agent_token,room_code,agent_name,status) VALUES('ag_unlimited','at_unlimited','uuu-uuuu-uuuu','Agent','active');");
 const user='44444444-4444-4444-8444-444444444444';
 await db.query("SELECT human_join('uuu-uuuu-uuuu',$1,'Human','creator-unlimited')",[user]);
 await db.exec("SELECT send_message('uuu-uuuu-uuuu','ag_unlimited','Agent','Message '||i) FROM generate_series(1,1105) i;");
 const result=await db.query<{result:{room_message_count:number,max_messages:number}}>("SELECT human_message('uuu-uuuu-uuuu',$1,$2,'Human after 1105','voice') AS result",[user,crypto.randomUUID()]);
 expect(result.rows[0].result).toMatchObject({room_message_count:1106,max_messages:0});
 expect((await db.query<{state:string}>("SELECT state FROM rooms WHERE room_code='uuu-uuuu-uuuu'")).rows[0].state).toBe('active');
 expect((await db.query("SELECT * FROM messages WHERE room_code='uuu-uuuu-uuuu'")).rows).toHaveLength(1106);
 await db.exec("UPDATE rooms SET state='locked',lock_reason='creator_locked',locked_at=now() WHERE room_code='uuu-uuuu-uuuu'");
 await expect(db.query("SELECT human_message('uuu-uuuu-uuuu',$1,$2,'Must reject','chat')",[user,crypto.randomUUID()])).rejects.toThrow('human:room_locked');
 expect((await db.query("SELECT * FROM messages WHERE room_code='uuu-uuuu-uuuu'")).rows).toHaveLength(1106);
});
