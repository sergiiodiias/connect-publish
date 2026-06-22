DELETE FROM public.auto_comments
WHERE ctid IN (
  SELECT ctid
  FROM (
    SELECT
      ctid,
      row_number() OVER (
        PARTITION BY post_id, target_id, message
        ORDER BY created_at ASC, ctid ASC
      ) AS rn
    FROM public.auto_comments
    WHERE target_id IS NOT NULL
  ) duplicated
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS auto_comments_unique_target_message
  ON public.auto_comments (post_id, target_id, message)
  WHERE target_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS auto_comments_unique_fb_comment_id
  ON public.auto_comments (fb_comment_id)
  WHERE fb_comment_id IS NOT NULL;