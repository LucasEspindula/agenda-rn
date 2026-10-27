-- RN Integra: criação atômica das sugestões dos médicos.
-- Uma falha em notificações ou auditoria deve desfazer a solicitação inteira.
CREATE OR REPLACE FUNCTION public.submit_agenda_suggestion(
  p_request jsonb,
  p_notification jsonb,
  p_audit jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
DECLARE
  request_id text := nullif(p_request->>'id','');
  requester bigint := nullif(p_request->>'requested_by','')::bigint;
  action_name text := p_request->>'action';
  appointment_key text := nullif(p_request->>'appointment_id','');
  existing_id text;
BEGIN
  IF request_id IS NULL OR requester IS NULL OR action_name NOT IN ('create','update','delete')
     OR appointment_key IS NULL OR p_notification->>'request_id' IS DISTINCT FROM request_id
     OR p_audit->'metadata'->>'requestId' IS DISTINCT FROM request_id THEN
    RAISE EXCEPTION 'Solicitação de agenda inválida';
  END IF;

  -- Também impede solicitações pendentes duplicadas em envios simultâneos.
  PERFORM pg_advisory_xact_lock(194701,3);
  SELECT id INTO existing_id
  FROM public.agenda_requests
  WHERE requested_by=requester AND action=action_name
    AND appointment_id IS NOT DISTINCT FROM appointment_key AND status='pending'
  ORDER BY created_at DESC LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  INSERT INTO public.agenda_requests
    (id,professional_id,appointment_id,action,proposed_payload,previous_payload,requested_by,created_at)
  VALUES
    (request_id,p_request->>'professional_id',appointment_key,action_name,
     NULLIF(p_request->'proposed_payload','null'::jsonb),NULLIF(p_request->'previous_payload','null'::jsonb),requester,
     (p_request->>'created_at')::timestamptz);

  INSERT INTO public.notifications
    (id,user_id,type,request_id,message,created_at)
  VALUES
    (p_notification->>'id',requester,'request_sent',request_id,
     'Alteração de agenda enviada.',(p_request->>'created_at')::timestamptz);

  INSERT INTO public.audit_logs
    (id,actor_user_id,actor_name,actor_role,action,professional_id,appointment_id,
     patient_id,description,metadata,created_at)
  VALUES
    (p_audit->>'id',requester,p_audit->>'actor_name',p_audit->>'actor_role',
     'request_created',p_audit->>'professional_id',nullif(p_audit->>'appointment_id',''),
     nullif(p_audit->>'patient_id',''),p_audit->>'description',p_audit->'metadata',
     (p_request->>'created_at')::timestamptz);

  RETURN request_id;
END;
$fn$;

-- A função recebe snapshots clínicos; apenas o backend service_role pode chamá-la.
REVOKE ALL ON FUNCTION public.submit_agenda_suggestion(jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_agenda_suggestion(jsonb,jsonb,jsonb) TO service_role;

-- Repara apenas sugestões pendentes recentes cuja gravação parcial foi confirmada.
INSERT INTO public.notifications (id,user_id,type,request_id,message,created_at)
SELECT gen_random_uuid()::text,r.requested_by,'request_sent',r.id,
       'Alteração de agenda enviada.',r.created_at
FROM public.agenda_requests r
WHERE r.status='pending' AND r.created_at >= TIMESTAMPTZ '2026-10-27 00:00:00+00'
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.request_id=r.id AND n.type='request_sent'
  );
