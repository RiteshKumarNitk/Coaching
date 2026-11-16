-- `system_settings` was created in 0001 as a key/value store, but institute
-- preferences moved to `app_settings` (0007) and nothing reads the old table.
-- Drop it instead of keeping two settings stores around.
DROP TABLE IF EXISTS system_settings;
