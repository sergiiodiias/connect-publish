
-- Adicionar status 'publishing' ao enum (atomic claim do scheduler depende disso)
ALTER TYPE public.comment_status ADD VALUE IF NOT EXISTS 'publishing';

-- Adicionar colunas para auto-recuperação de comentários travados
ALTER TABLE public.auto_comments
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Trigger para manter updated_at
DROP TRIGGER IF EXISTS auto_comments_set_updated_at ON public.auto_comments;
CREATE TRIGGER auto_comments_set_updated_at
  BEFORE UPDATE ON public.auto_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
