-- PHAM Edition 01 canonical size correction.
-- Forward-only migration for remote databases that may already have the earlier XS/S/M/L/XL seed.
UPDATE editions
SET size_options_csv = 'M,L,XL,XXL',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'edition-01'
  AND size_options_csv IN ('XS,S,M,L,XL', 'M,L,XL,XXL');
