-- Retirada do antigo workspace experimental de documentos de convênios.
-- O módulo não participa dos atendimentos, cobranças ou glosas operacionais.
-- Ordem de exclusão validada contra pg_depend e chaves estrangeiras do projeto.
-- RESTRICT impede excluir inadvertidamente objetos externos ao módulo.
DROP FUNCTION IF EXISTS public.apply_perseus_semantic_review(uuid,text,text,text,boolean,jsonb,jsonb,timestamptz,bigint);
DROP FUNCTION IF EXISTS public.apply_perseus_semantic_value_correction(uuid,uuid,text,text,timestamptz,bigint);
DROP FUNCTION IF EXISTS public.replace_perseus_document_analysis(uuid,jsonb,text,text,jsonb,bigint);
DROP FUNCTION IF EXISTS public.revoke_perseus_semantic_rule(uuid,bigint);
DROP TABLE IF EXISTS public.perseus_document_events RESTRICT;
DROP TABLE IF EXISTS public.perseus_semantic_value_corrections RESTRICT;
DROP TABLE IF EXISTS public.perseus_semantic_reviews RESTRICT;
DROP TABLE IF EXISTS public.perseus_semantic_rules RESTRICT;
DROP TABLE IF EXISTS public.insurance_document_items RESTRICT;
DROP TABLE IF EXISTS public.insurance_documents RESTRICT;
DROP TABLE IF EXISTS public.insurance_movements RESTRICT;
