-- 1. Chave-mestra (vault)
DO $$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'FB_TOKEN_ENC_KEY';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'FB_TOKEN_ENC_KEY',
      'Chave-mestra para criptografar fb_pages.access_token'
    );
  END IF;
END $$;

-- 2. Função que lê a chave (PRIMEIRO)
CREATE OR REPLACE FUNCTION public._fb_enc_key()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = vault, public AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'FB_TOKEN_ENC_KEY' LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public._fb_enc_key() FROM PUBLIC, anon, authenticated;

-- 3. Encrypt / Decrypt
CREATE OR REPLACE FUNCTION public.encrypt_fb_token(plain text)
RETURNS bytea LANGUAGE sql SECURITY DEFINER VOLATILE
SET search_path = public, extensions, vault AS $$
  SELECT CASE WHEN plain IS NULL THEN NULL ELSE extensions.pgp_sym_encrypt(plain, public._fb_enc_key()) END;
$$;
REVOKE EXECUTE ON FUNCTION public.encrypt_fb_token(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.decrypt_fb_token(enc bytea)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, extensions, vault AS $$
  SELECT CASE WHEN enc IS NULL THEN NULL ELSE extensions.pgp_sym_decrypt(enc, public._fb_enc_key()) END;
$$;
REVOKE EXECUTE ON FUNCTION public.decrypt_fb_token(bytea) FROM PUBLIC, anon, authenticated;

-- 4. Coluna + trigger
ALTER TABLE public.fb_pages ADD COLUMN IF NOT EXISTS access_token_enc bytea;

CREATE OR REPLACE FUNCTION public.fb_pages_sync_token_enc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.access_token IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.access_token IS DISTINCT FROM OLD.access_token OR NEW.access_token_enc IS NULL THEN
      NEW.access_token_enc := public.encrypt_fb_token(NEW.access_token);
    END IF;
  END IF;
  RETURN NEW;
END;$$;
REVOKE EXECUTE ON FUNCTION public.fb_pages_sync_token_enc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS fb_pages_encrypt_token ON public.fb_pages;
CREATE TRIGGER fb_pages_encrypt_token
BEFORE INSERT OR UPDATE OF access_token ON public.fb_pages
FOR EACH ROW EXECUTE FUNCTION public.fb_pages_sync_token_enc();

-- 5. Backfill
UPDATE public.fb_pages
SET access_token_enc = public.encrypt_fb_token(access_token)
WHERE access_token IS NOT NULL AND access_token_enc IS NULL;