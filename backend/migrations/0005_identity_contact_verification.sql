-- Operator-only evidence that a collector contacted PHAM by email or WhatsApp.
-- Evidence reference is a staff-verified message ID; avoid logging full message text.
ALTER TABLE identity_claims ADD COLUMN contact_channel TEXT;
ALTER TABLE identity_claims ADD COLUMN contact_reference TEXT;
ALTER TABLE identity_claims ADD COLUMN contact_verified_at TEXT;
