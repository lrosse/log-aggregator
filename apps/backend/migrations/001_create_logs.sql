CREATE TABLE logs (
  id BIGSERIAL PRIMARY KEY,
  service VARCHAR(80) NOT NULL,
  level VARCHAR(5) NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 8000),
  timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX logs_service_id_idx ON logs (service, id DESC);
CREATE INDEX logs_level_id_idx ON logs (level, id DESC);
CREATE INDEX logs_received_at_idx ON logs (received_at DESC);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX logs_message_trgm_idx ON logs USING GIN (message gin_trgm_ops);
