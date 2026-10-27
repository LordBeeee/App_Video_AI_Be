-- Keep older duplicate files and their links for audit/reference use, but expose
-- only one generated video asset per generation in the library.
BEGIN;

UPDATE public.assets AS asset
SET metadata = COALESCE(asset.metadata, '{}'::jsonb) ||
  jsonb_build_object('generationId', link.generation_id)
FROM public.ai_generation_assets AS link
WHERE link.asset_id = asset.id
  AND link.role = 'output'
  AND asset.asset_type = 'video'
  AND asset.asset_role = 'output'
  AND asset.source_type = 'generated'
  AND NOT jsonb_exists(COALESCE(asset.metadata, '{}'::jsonb), 'generationId');

WITH ranked AS (
  SELECT id,
    first_value(id) OVER (
      PARTITION BY metadata->>'generationId'
      ORDER BY is_favorite DESC, created_at ASC, id ASC
    ) AS keeper,
    row_number() OVER (
      PARTITION BY metadata->>'generationId'
      ORDER BY is_favorite DESC, created_at ASC, id ASC
    ) AS position
  FROM public.assets
  WHERE asset_type = 'video' AND asset_role = 'output'
    AND source_type = 'generated' AND jsonb_exists(metadata, 'generationId')
)
UPDATE public.assets AS asset
SET metadata = asset.metadata || jsonb_build_object('duplicateOf', ranked.keeper)
FROM ranked
WHERE asset.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_generated_video_generation
ON public.assets ((metadata->>'generationId'))
WHERE asset_type = 'video' AND asset_role = 'output'
  AND source_type = 'generated' AND jsonb_exists(metadata, 'generationId')
  AND NOT jsonb_exists(metadata, 'duplicateOf');

COMMIT;
