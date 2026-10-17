-- Additive only. Apply once to the existing PostgreSQL/Supabase database.
BEGIN;
CREATE TABLE public.human_sessions (
 room_code varchar(14) NOT NULL REFERENCES public.rooms(room_code),
 user_id uuid NOT NULL,
 participant_id varchar(20) NOT NULL UNIQUE REFERENCES public.agents(agent_id),
 display_name varchar(100) NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '8 hours',
 last_seen_at timestamptz,
 PRIMARY KEY(room_code,user_id)
);
CREATE TABLE public.human_message_receipts (
 room_code varchar(14) NOT NULL REFERENCES public.rooms(room_code),
 participant_id varchar(20) NOT NULL REFERENCES public.agents(agent_id),
 client_message_id uuid NOT NULL,
 message_id integer NOT NULL REFERENCES public.messages(id),
 source varchar(5) NOT NULL CHECK(source IN ('chat','voice')),
 PRIMARY KEY(room_code,participant_id,client_message_id)
);
ALTER TABLE public.human_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.human_message_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.human_sessions, public.human_message_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.human_sessions, public.human_message_receipts TO service_role;

CREATE FUNCTION public.human_join(p_room_code text,p_user_id uuid,p_display_name text,p_creator_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r rooms; s human_sessions; a agents; pid text;
BEGIN
 SELECT * INTO r FROM rooms WHERE room_code=p_room_code FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'human:room_not_found'; END IF;
 IF r.state <> 'active' THEN RAISE EXCEPTION 'human:room_locked'; END IF;
 SELECT * INTO s FROM human_sessions WHERE room_code=p_room_code AND user_id=p_user_id FOR UPDATE;
 IF FOUND THEN
  SELECT * INTO a FROM agents WHERE agent_id=s.participant_id FOR UPDATE;
  IF a.status='kicked' THEN RAISE EXCEPTION 'human:forbidden'; END IF;
 ELSE
  IF p_creator_token IS NULL OR p_creator_token<>r.creator_token THEN RAISE EXCEPTION 'human:forbidden'; END IF;
 END IF;
 IF length(trim(p_display_name)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'human:invalid_request'; END IF;
 IF s.participant_id IS NULL OR a.status<>'active' THEN
  IF (SELECT count(*) FROM agents WHERE room_code=p_room_code AND status='active')>=20 THEN RAISE EXCEPTION 'human:room_full'; END IF;
 END IF;
 pid := COALESCE(s.participant_id,'hu_' || substr(replace(gen_random_uuid()::text,'-',''),1,17));
 INSERT INTO agents(agent_id,agent_token,room_code,agent_name,status,activated_at)
 VALUES(pid,substr(replace(gen_random_uuid()::text,'-',''),1,12),p_room_code,trim(p_display_name),'active',now())
 ON CONFLICT(agent_id) DO UPDATE SET agent_name=excluded.agent_name,status='active',activated_at=now(),left_at=NULL;
 INSERT INTO human_sessions(room_code,user_id,participant_id,display_name,last_seen_at)
 VALUES(p_room_code,p_user_id,pid,trim(p_display_name),now())
 ON CONFLICT(room_code,user_id) DO UPDATE SET display_name=excluded.display_name,expires_at=now()+interval '8 hours',last_seen_at=now()
 RETURNING * INTO s;
 RETURN jsonb_build_object('participant_id',s.participant_id,'display_name',s.display_name,'status','active','expires_at',s.expires_at);
END $$;

CREATE FUNCTION public.human_message(p_room_code text,p_user_id uuid,p_client_message_id uuid,p_content text,p_source text DEFAULT 'chat')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r rooms; s human_sessions; a agents; m messages; receipt human_message_receipts; result jsonb;
BEGIN
 SELECT * INTO r FROM rooms WHERE room_code=p_room_code FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'human:room_not_found'; END IF;
 SELECT * INTO s FROM human_sessions WHERE room_code=p_room_code AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR s.expires_at<=now() THEN RAISE EXCEPTION 'human:forbidden'; END IF;
 SELECT * INTO a FROM agents WHERE agent_id=s.participant_id FOR UPDATE;
 IF a.status<>'active' THEN RAISE EXCEPTION 'human:forbidden'; END IF;
 IF length(trim(p_content)) NOT BETWEEN 1 AND 4000 OR p_source NOT IN ('chat','voice') THEN RAISE EXCEPTION 'human:invalid_request'; END IF;
 SELECT * INTO receipt FROM human_message_receipts WHERE room_code=p_room_code AND participant_id=s.participant_id AND client_message_id=p_client_message_id;
 IF FOUND THEN
  SELECT * INTO m FROM messages WHERE id=receipt.message_id;
  IF m.content<>p_content OR receipt.source<>p_source THEN RAISE EXCEPTION 'human:idempotency_conflict'; END IF;
  RETURN jsonb_build_object('message_id',m.room_seq,'timestamp',m.created_at,'room_message_count',r.message_count,'max_messages',r.max_messages);
 END IF;
 IF r.state<>'active' OR r.message_count>=r.max_messages THEN RAISE EXCEPTION 'human:room_locked'; END IF;
 -- Session-row lock serializes sends for this participant across all instances.
 IF EXISTS(SELECT 1 FROM human_message_receipts h JOIN messages msg ON msg.id=h.message_id WHERE h.participant_id=s.participant_id AND msg.created_at>now()-interval '1 second') THEN RAISE EXCEPTION 'human:rate_limited'; END IF;
 result := public.send_message(p_room_code,s.participant_id,s.display_name,p_content)::jsonb;
 SELECT * INTO m FROM messages WHERE room_code=p_room_code AND room_seq=(result->>'message_id')::integer;
 INSERT INTO human_message_receipts VALUES(p_room_code,s.participant_id,p_client_message_id,m.id,p_source);
 UPDATE human_sessions SET last_seen_at=now() WHERE room_code=p_room_code AND user_id=p_user_id;
 IF (result->>'room_message_count')::integer>=r.max_messages THEN
  UPDATE rooms SET state='locked',lock_reason='max_messages_reached',locked_at=now() WHERE room_code=p_room_code;
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.human_session(p_room_code text,p_user_id uuid,p_action text DEFAULT 'get')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE s human_sessions; a agents;
BEGIN
 SELECT * INTO s FROM human_sessions WHERE room_code=p_room_code AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR s.expires_at<=now() THEN RAISE EXCEPTION 'human:forbidden'; END IF;
 SELECT * INTO a FROM agents WHERE agent_id=s.participant_id FOR UPDATE;
 IF a.status<>'active' THEN RAISE EXCEPTION 'human:forbidden'; END IF;
 IF p_action='leave' THEN
  UPDATE agents SET status='left',left_at=now() WHERE agent_id=s.participant_id;
  UPDATE human_sessions SET last_seen_at=NULL WHERE room_code=p_room_code AND user_id=p_user_id;
  RETURN jsonb_build_object('status','left');
 ELSIF p_action='heartbeat' THEN
  UPDATE human_sessions SET last_seen_at=now() WHERE room_code=p_room_code AND user_id=p_user_id;
 ELSIF p_action='presence' THEN
  RETURN jsonb_build_object('participants',(SELECT COALESCE(jsonb_agg(jsonb_build_object('participant_id',h.participant_id,'display_name',h.display_name,'online',COALESCE(h.last_seen_at>now()-interval '45 seconds',false)) ORDER BY h.display_name),'[]'::jsonb) FROM human_sessions h JOIN agents ag ON ag.agent_id=h.participant_id WHERE h.room_code=p_room_code AND h.expires_at>now() AND ag.status='active'));
 ELSIF p_action<>'get' THEN RAISE EXCEPTION 'human:invalid_request'; END IF;
 RETURN jsonb_build_object('participant_id',s.participant_id,'display_name',s.display_name,'status',a.status,'expires_at',s.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.human_join(text,uuid,text,text), public.human_message(text,uuid,uuid,text,text), public.human_session(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.human_join(text,uuid,text,text), public.human_message(text,uuid,uuid,text,text), public.human_session(text,uuid,text) TO service_role;
COMMIT;
