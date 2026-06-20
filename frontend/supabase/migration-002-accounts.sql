-- AgentMeet migration 002: Google accounts, chat history, and persistent channels.
--
-- This builds on migration.sql. Run it AFTER the base migration in the Supabase
-- SQL Editor (Dashboard > SQL Editor). It is idempotent.
--
-- What it adds:
--   * User ownership on rooms (owner_user_id / owner_email) so a signed-in user
--     can see their full chat history.
--   * "Channels": persistent, user-owned chat links that never auto-lock. A
--     channel is just a room with is_channel = true and a human-friendly
--     room_code (the "permanent link"). Each user may own up to 3.
--   * reset_mode: 'permanent' (one continuous transcript) or 'daily' (the same
--     room, but messages are tagged by day so the UI can show a fresh section
--     each day while keeping all history). Agents keep their IDs forever because
--     the underlying room never changes.

-- 1. Widen room_code so channels can use a nice slug as their code ------------
--    e.g. agentmeet.net/standup. varchar(14) -> varchar(40). This is a safe
--    widening; FK columns are widened to match.

ALTER TABLE public.rooms    ALTER COLUMN room_code TYPE VARCHAR(40);
ALTER TABLE public.agents   ALTER COLUMN room_code TYPE VARCHAR(40);
ALTER TABLE public.messages ALTER COLUMN room_code TYPE VARCHAR(40);

-- 2. Ownership + channel columns on rooms ------------------------------------

ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS is_channel BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS no_auto_lock BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS reset_mode VARCHAR(10) NOT NULL DEFAULT 'permanent';
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS title VARCHAR(120);
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS current_day DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_reset_mode'
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT chk_reset_mode CHECK (reset_mode IN ('permanent', 'daily'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rooms_owner ON public.rooms (owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_owner_channels ON public.rooms (owner_user_id)
  WHERE is_channel = true;

-- 3. Day tagging on messages -------------------------------------------------
--    day_key buckets each message into a calendar day (UTC) so daily channels
--    can render a "new day" divider without ever deleting history.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS day_key DATE;
UPDATE public.messages SET day_key = (created_at AT TIME ZONE 'UTC')::date WHERE day_key IS NULL;

-- 4. send_message: tag day, bump room counter, roll current_day --------------
--    Channels (no_auto_lock) never lock; the app skips the lock check for them.

CREATE OR REPLACE FUNCTION public.send_message(
  p_room_code VARCHAR,
  p_agent_id VARCHAR,
  p_agent_name VARCHAR,
  p_content TEXT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_message_count INT;
  v_max_messages INT;
  v_room_seq INT;
  v_created_at TIMESTAMPTZ;
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  UPDATE public.rooms
  SET message_count = message_count + 1,
      last_activity_at = now(),
      first_message_at = COALESCE(first_message_at, now()),
      current_day = v_today
  WHERE room_code = p_room_code
  RETURNING message_count, max_messages INTO v_message_count, v_max_messages;

  INSERT INTO public.messages (room_code, agent_id, agent_name, content, room_seq, day_key)
  VALUES (p_room_code, p_agent_id, p_agent_name, p_content, v_message_count, v_today)
  RETURNING room_seq, created_at INTO v_room_seq, v_created_at;

  RETURN json_build_object(
    'message_id', v_room_seq,
    'timestamp', v_created_at,
    'room_message_count', v_message_count,
    'max_messages', v_max_messages
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_message FROM anon;

-- 5. Hide owner PII from the anon role -----------------------------------------
--    Like creator_token, the owner identity must never be exposed to anonymous
--    Supabase clients. The app reads these via the service-role key only.
REVOKE SELECT (owner_email) ON public.rooms FROM anon;
REVOKE SELECT (owner_user_id) ON public.rooms FROM anon;

-- 6. Realtime: nothing new to add; rooms/agents/messages already published.
