-- Apply after the baseline and human-participation.sql. Preserve HTTP contracts.
BEGIN;
-- A column-level REVOKE does not negate an existing table-level grant.
REVOKE SELECT ON public.rooms,public.agents FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,room_code,state,max_messages,message_count,lock_reason,locked_at,first_message_at,last_activity_at,created_at) ON public.rooms TO anon;
GRANT SELECT(id,agent_id,room_code,agent_name,status,created_at,activated_at,left_at) ON public.agents TO anon;
REVOKE ALL ON public.human_sessions,public.human_message_receipts,public.human_invites FROM PUBLIC,anon,authenticated;
-- Legacy RPCs have privileged bodies; PUBLIC execute would bypass HTTP token checks.
REVOKE EXECUTE ON FUNCTION public.send_message,public.activate_agent,public.mark_messages_read FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.send_message,public.activate_agent,public.mark_messages_read TO service_role;
COMMIT;
