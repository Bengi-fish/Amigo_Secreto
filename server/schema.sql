CREATE TABLE IF NOT EXISTS game (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO game (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','participant')),
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Assignment keys: public key in clear, private key only encrypted with the personal password.
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS private_key_box TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS key_salt TEXT;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
-- Private key encrypted with the raw session token, which only the browser cookie holds.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS key_box TEXT;
-- The first version stored recipient_id in clear. Replace that table only while it is empty;
-- never touch a draw that already happened.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'assignments' AND column_name = 'recipient_id') THEN
    IF EXISTS (SELECT 1 FROM assignments) THEN RAISE EXCEPTION 'Existe un sorteo sin cifrar; no se migra.'; END IF;
    DROP TABLE assignments;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS assignments (
  giver_id UUID PRIMARY KEY REFERENCES users(id),
  sealed TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reveals (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  revealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  resets_at TIMESTAMPTZ NOT NULL
);
CREATE OR REPLACE FUNCTION immutable_assignments() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Las asignaciones son permanentes';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS assignments_immutable ON assignments;
CREATE TRIGGER assignments_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON assignments
FOR EACH STATEMENT EXECUTE FUNCTION immutable_assignments();
CREATE OR REPLACE FUNCTION protect_roster() RETURNS TRIGGER AS $$
DECLARE is_locked BOOLEAN;
BEGIN
  SELECT locked INTO is_locked FROM game WHERE id=1 FOR UPDATE;
  IF is_locked THEN
    IF TG_OP IN ('INSERT','DELETE') THEN RAISE EXCEPTION 'La lista está cerrada'; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.name IS DISTINCT FROM OLD.name OR NEW.username IS DISTINCT FROM OLD.username OR NEW.role IS DISTINCT FROM OLD.role OR NEW.public_key IS DISTINCT FROM OLD.public_key THEN
      RAISE EXCEPTION 'La lista está cerrada';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS roster_frozen ON users;
CREATE TRIGGER roster_frozen BEFORE INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION protect_roster();
CREATE OR REPLACE FUNCTION protect_game() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'El juego no se puede eliminar'; END IF;
  IF OLD.locked AND NOT NEW.locked THEN RAISE EXCEPTION 'El sorteo es permanente'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS game_permanent ON game;
CREATE TRIGGER game_permanent BEFORE UPDATE OR DELETE ON game
FOR EACH ROW EXECUTE FUNCTION protect_game();
