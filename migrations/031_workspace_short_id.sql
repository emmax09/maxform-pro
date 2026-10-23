-- Short, non-sequential public identifier for a user/workspace, used in
-- public URLs instead of the raw internal UUID (shorter, and doesn't leak
-- the real primary key).
ALTER TABLE users ADD COLUMN IF NOT EXISTS short_id VARCHAR(6);

DO $$
DECLARE
  charset TEXT := '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  rec RECORD;
  candidate TEXT;
  i INT;
BEGIN
  FOR rec IN SELECT id FROM users WHERE short_id IS NULL LOOP
    LOOP
      candidate := '';
      FOR i IN 1..5 LOOP
        candidate := candidate || substr(charset, floor(random() * length(charset))::int + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE short_id = candidate);
    END LOOP;
    UPDATE users SET short_id = candidate WHERE id = rec.id;
  END LOOP;
END $$;

ALTER TABLE users ALTER COLUMN short_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_short_id ON users(short_id);
