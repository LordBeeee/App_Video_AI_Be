BEGIN;

UPDATE public.assets
SET source_type = 'external',
    metadata = CASE
      WHEN asset_role = 'element' AND storage_provider = 'kling' THEN
        (metadata - 'referenceType' - 'referenceUrls') ||
        jsonb_build_object(
          'elementType', metadata->'referenceType',
          'sourceUrls', COALESCE(metadata->'referenceUrls', '[]'::jsonb)
        )
      ELSE metadata - 'referenceType'
    END
WHERE source_type = 'reference';

ALTER TABLE public.assets DROP CONSTRAINT chk_assets_source_type;
ALTER TABLE public.assets ADD CONSTRAINT chk_assets_source_type
  CHECK (source_type IN ('uploaded', 'generated', 'external'));

COMMIT;
