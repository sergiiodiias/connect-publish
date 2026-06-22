
CREATE POLICY "media_user_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1] OR bucket_id = 'media' AND owner = auth.uid());
CREATE POLICY "media_user_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND owner = auth.uid());
CREATE POLICY "media_user_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND owner = auth.uid());
CREATE POLICY "media_user_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND owner = auth.uid());
