-- Keep collector production requests private: no public provenance exposure.
ALTER TABLE identity_claims ADD COLUMN production_notes TEXT;
