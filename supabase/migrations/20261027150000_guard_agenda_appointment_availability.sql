-- RN Integra: database-level availability guard over the JSONB agenda.
-- This is additive. Existing appointments that are not newly scheduled or
-- rescheduled are never rewritten, deleted or invalidated by later blocks.
-- The trigger runs during the transaction that persists/approves an agenda change.
CREATE OR REPLACE FUNCTION public.guard_agenda_appointment_availability()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
DECLARE
  a jsonb; prior jsonb; b jsonb; r jsonb; p jsonb;
  old_payload jsonb; day_value date; occurrence integer; weekday integer;
  beginning integer; ending integer; block_start integer; block_end integer;
  work_start integer; work_end integer; r_start integer; r_end integer;
  pid text; doctor text; hospital_id text; procedure_name text; date_text text;
  allowed_times text[]; forbidden_time text; max_patients integer; used_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(194701,1);
  old_payload:=CASE WHEN TG_OP='UPDATE' THEN OLD.payload ELSE '{}'::jsonb END;
  FOR a IN SELECT value FROM jsonb_array_elements(coalesce(NEW.payload->'appointments','[]'::jsonb))
  LOOP
    IF a->>'status'='cancelled' THEN CONTINUE; END IF;
    SELECT value INTO prior FROM jsonb_array_elements(coalesce(old_payload->'appointments','[]'::jsonb))
      WHERE value->>'id'=a->>'id' LIMIT 1;
    IF prior IS NOT NULL AND
      (prior->>'date',prior->>'time',prior->>'duration',prior->>'doctorId',
       prior->>'anesthetistId',prior->>'hospitalId',prior->>'procedure')
      IS NOT DISTINCT FROM
      (a->>'date',a->>'time',a->>'duration',a->>'doctorId',
       a->>'anesthetistId',a->>'hospitalId',a->>'procedure') THEN
      CONTINUE;
    END IF;
    date_text:=a->>'date';
    IF date_text IS NULL OR a->>'time' IS NULL THEN CONTINUE; END IF;
    day_value:=date_text::date; weekday:=extract(dow from day_value)::int;
    occurrence:=((extract(day from day_value)::int-1)/7)+1;
    beginning:=split_part(a->>'time',':',1)::int*60+split_part(a->>'time',':',2)::int;
    ending:=beginning+coalesce((a->>'duration')::int,0);
    IF ending<=beginning THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Horário indisponível: duração inválida.';
    END IF;
    doctor:=a->>'doctorId';hospital_id:=a->>'hospitalId';procedure_name:=coalesce(a->>'procedure','');

    -- Manual schedule blocks apply to both surgeon and anesthetist, including
    -- intervals crossed by the appointment rather than just the start time.
    FOR b IN SELECT value FROM jsonb_array_elements(coalesce(NEW.payload->'scheduleBlocks','[]'::jsonb))
      WHERE value->>'date'=date_text AND value->>'professionalId' IN (doctor,coalesce(a->>'anesthetistId',''))
    LOOP
      block_start:=split_part(b->>'start',':',1)::int*60+split_part(b->>'start',':',2)::int;
      block_end:=split_part(b->>'end',':',1)::int*60+split_part(b->>'end',':',2)::int;
      IF beginning<block_end AND ending>block_start THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Horário indisponível: bloqueio do profissional.';
      END IF;
    END LOOP;
    IF doctor IS NULL OR doctor='' THEN CONTINUE; END IF;

    SELECT value INTO p FROM jsonb_array_elements(coalesce(NEW.payload->'professionals','[]'::jsonb))
      WHERE value->>'id'=doctor LIMIT 1;
    work_start:=coalesce(nullif(split_part(coalesce(p->'agendaSettings'->>'workStart',NEW.payload->'settings'->>'workStart','07:00'),':',1),''),'07')::int*60
      +coalesce(nullif(split_part(coalesce(p->'agendaSettings'->>'workStart',NEW.payload->'settings'->>'workStart','07:00'),':',2),''),'00')::int;
    work_end:=coalesce(nullif(split_part(coalesce(p->'agendaSettings'->>'workEnd',NEW.payload->'settings'->>'workEnd','19:00'),':',1),''),'19')::int*60
      +coalesce(nullif(split_part(coalesce(p->'agendaSettings'->>'workEnd',NEW.payload->'settings'->>'workEnd','19:00'),':',2),''),'00')::int;

    FOR r IN SELECT value FROM jsonb_array_elements(coalesce(NEW.payload->'schedulingRules','[]'::jsonb))
      WHERE value->>'professionalId'=doctor AND value->>'enabled' IS DISTINCT FROM 'false'
        AND (value->>'blockAllDay'='true' OR value->>'severity'='block')
    LOOP
      IF nullif(r->>'weekday','') IS NOT NULL AND (r->>'weekday')::int<>weekday THEN CONTINUE; END IF;
      IF nullif(r->>'occurrence','') IS NOT NULL THEN
        IF r->>'occurrence'='last' THEN
          IF extract(month from day_value+7)::int=extract(month from day_value)::int THEN CONTINUE; END IF;
        ELSIF (r->>'occurrence')::int<>occurrence THEN CONTINUE; END IF;
      END IF;
      IF r->>'blockAllDay'='true' THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Horário indisponível: dia totalmente bloqueado.';
      END IF;
      -- A rule's start/end encode the allowed window. Its complement is
      -- blocked, as already drawn by the existing desktop calendar.
      IF nullif(r->>'start','') IS NOT NULL THEN
        r_start:=split_part(r->>'start',':',1)::int*60+split_part(r->>'start',':',2)::int;
        IF r_start>work_start AND beginning<least(r_start,work_end) AND ending>work_start THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Horário indisponível: antes da janela permitida.';
        END IF;
      END IF;
      IF nullif(r->>'end','') IS NOT NULL THEN
        r_end:=split_part(r->>'end',':',1)::int*60+split_part(r->>'end',':',2)::int;
        IF r_end<work_end AND beginning<work_end AND ending>greatest(r_end,work_start) THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Horário indisponível: após a janela permitida.';
        END IF;
      END IF;
      FOR forbidden_time IN SELECT btrim(value) FROM regexp_split_to_table(coalesce(r->>'forbiddenTimes',''),',') AS value
        WHERE btrim(value)<>'' LOOP
        block_start:=split_part(forbidden_time,':',1)::int*60+split_part(forbidden_time,':',2)::int;
        IF beginning<least(block_start+30,work_end) AND ending>block_start THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Horário indisponível: horário proibido.';
        END IF;
      END LOOP;
      -- Advanced rule restrictions keep their existing scope (hospital /
      -- procedure), unlike absolute time bands and full-day closure.
      IF nullif(r->>'hospitalId','') IS NOT NULL AND r->>'hospitalId' IS DISTINCT FROM hospital_id THEN CONTINUE; END IF;
      IF nullif(r->>'procedureContains','') IS NOT NULL AND position(lower(r->>'procedureContains') in lower(procedure_name))=0 THEN CONTINUE; END IF;
      IF nullif(r->>'preferredTimes','') IS NOT NULL THEN
        SELECT array_agg(btrim(value)) INTO allowed_times FROM regexp_split_to_table(r->>'preferredTimes',',') AS value WHERE btrim(value)<>'';
        IF array_length(allowed_times,1)>0 AND NOT (a->>'time'=ANY(allowed_times)) THEN
          RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Horário indisponível: fora dos horários permitidos.';
        END IF;
      END IF;
      IF nullif(r->>'maxPatients','') IS NOT NULL THEN
        max_patients:=(r->>'maxPatients')::int;
        IF max_patients>0 THEN
          SELECT count(*) INTO used_count FROM jsonb_array_elements(coalesce(NEW.payload->'appointments','[]'::jsonb)) AS item
          WHERE item->>'id' IS DISTINCT FROM a->>'id' AND item->>'doctorId'=doctor
            AND item->>'date'=date_text AND item->>'status' IS DISTINCT FROM 'cancelled'
            AND (nullif(r->>'hospitalId','') IS NULL OR item->>'hospitalId'=r->>'hospitalId');
          IF used_count>=max_patients THEN
            RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Horário indisponível: limite diário atingido.';
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS guard_agenda_appointment_availability ON public.app_state;
CREATE TRIGGER guard_agenda_appointment_availability
BEFORE INSERT OR UPDATE OF payload ON public.app_state
FOR EACH ROW EXECUTE FUNCTION public.guard_agenda_appointment_availability();
