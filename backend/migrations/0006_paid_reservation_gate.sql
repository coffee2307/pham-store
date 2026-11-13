-- Fail-closed acceptance gate independent of storefront theme and legacy edition state.
-- Existing production Edition 01 stays CLOSED, even if its old state says reservation_open.
-- Only the authenticated launch state transition may set this gate to 1.
ALTER TABLE editions ADD COLUMN commerce_acceptance_enabled INTEGER NOT NULL DEFAULT 0;
