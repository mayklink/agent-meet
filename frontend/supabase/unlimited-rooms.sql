-- 0 is unlimited; keep the numeric HTTP field and explicit legacy limits.
BEGIN;
ALTER TABLE public.rooms DROP CONSTRAINT chk_max_messages;
ALTER TABLE public.rooms ADD CONSTRAINT chk_max_messages CHECK (max_messages=0 OR max_messages BETWEEN 5 AND 10000);
ALTER TABLE public.rooms ALTER COLUMN max_messages SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.human_message(p_room_code text,p_user_id uuid,p_client_message_id uuid,p_content text,p_source text DEFAULT 'chat')
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
 IF r.state<>'active' OR (r.max_messages>0 AND r.message_count>=r.max_messages) THEN RAISE EXCEPTION 'human:room_locked'; END IF;
 -- Session-row lock serializes sends for this participant across all instances.
 IF EXISTS(SELECT 1 FROM human_message_receipts h JOIN messages msg ON msg.id=h.message_id WHERE h.participant_id=s.participant_id AND msg.created_at>now()-interval '1 second') THEN RAISE EXCEPTION 'human:rate_limited'; END IF;
 result := public.send_message(p_room_code,s.participant_id,s.display_name,p_content)::jsonb;
 SELECT * INTO m FROM messages WHERE room_code=p_room_code AND room_seq=(result->>'message_id')::integer;
 INSERT INTO human_message_receipts VALUES(p_room_code,s.participant_id,p_client_message_id,m.id,p_source);
 UPDATE human_sessions SET last_seen_at=now() WHERE room_code=p_room_code AND user_id=p_user_id;
 IF r.max_messages>0 AND (result->>'room_message_count')::integer>=r.max_messages THEN
  UPDATE rooms SET state='locked',lock_reason='max_messages_reached',locked_at=now() WHERE room_code=p_room_code;
 END IF;
 RETURN result;
END $$;


COMMIT;
