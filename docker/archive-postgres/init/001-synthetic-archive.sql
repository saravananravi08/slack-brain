CREATE ROLE archive_reader LOGIN PASSWORD 'synthetic_reader_only';
ALTER ROLE archive_reader SET default_transaction_read_only = on;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  real_name TEXT,
  display_name TEXT
);

CREATE TABLE messages (
  ts TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  text TEXT NOT NULL,
  thread_ts TEXT,
  reply_count INTEGER DEFAULT 0,
  date TEXT NOT NULL,
  is_thread_reply INTEGER DEFAULT 0,
  raw_json TEXT
);

INSERT INTO users (id, name, real_name, display_name) VALUES
  ('U0SYNTH001', 'synthetic-one', 'Synthetic Member One', 'Synthetic One'),
  ('U0SYNTH002', 'synthetic-two', 'Synthetic Member Two', 'Synthetic Two'),
  ('U0SYNTH003', 'synthetic-three', 'Synthetic Member Three', 'Synthetic Three'),
  ('U0SYNTH004', 'synthetic-four', 'Synthetic Member Four', 'Synthetic Four'),
  ('U0SYNTH005', 'synthetic-five', 'Synthetic Member Five', 'Synthetic Five'),
  ('U0SYNTH006', 'synthetic-six', 'Synthetic Member Six', 'Synthetic Six'),
  ('U0SYNTH007', 'synthetic-seven', 'Synthetic Member Seven', 'Synthetic Seven'),
  ('U0SYNTH008', 'synthetic-eight', 'Synthetic Member Eight', 'Synthetic Eight'),
  ('B0SYNTH001', 'synthetic-bot', 'Synthetic Automation', 'Synthetic Bot');

WITH generated AS (
  SELECT
    channel_index,
    sequence_number,
    CASE channel_index
      WHEN 0 THEN 'C0APPROVED1'
      WHEN 1 THEN 'C0APPROVED2'
      ELSE 'C0UNAPPROV9'
    END AS channel_id,
    1740787200 + channel_index * 100000 + sequence_number * 60 AS epoch_seconds,
    ((sequence_number - 1) / 6) * 6 + 1 AS root_sequence
  FROM generate_series(0, 2) AS channel(channel_index)
  CROSS JOIN generate_series(1, 24) AS message(sequence_number)
), shaped AS (
  SELECT
    *,
    epoch_seconds::text || '.' || lpad(
      (channel_index * 1000 + sequence_number)::text,
      6,
      '0'
    ) AS message_ts,
    (1740787200 + channel_index * 100000 + root_sequence * 60)::text || '.' || lpad(
      (channel_index * 1000 + root_sequence)::text,
      6,
      '0'
    ) AS root_ts
  FROM generated
)
INSERT INTO messages (
  ts,
  channel_id,
  user_id,
  user_name,
  text,
  thread_ts,
  reply_count,
  date,
  is_thread_reply,
  raw_json
)
SELECT
  message_ts,
  channel_id,
  CASE
    WHEN sequence_number = 18 THEN 'B0SYNTH001'
    ELSE 'U0SYNTH' || lpad((((sequence_number - 1) % 8) + 1)::text, 3, '0')
  END,
  CASE
    WHEN sequence_number = 18 THEN 'Synthetic Bot'
    ELSE 'Synthetic Member ' || (((sequence_number - 1) % 8) + 1)::text
  END,
  CASE
    WHEN sequence_number = 12 THEN ''
    WHEN sequence_number = 20 THEN 'Synthetic member joined the channel.'
    ELSE format(
      'Synthetic archive message %s in %s for migration validation.',
      sequence_number,
      channel_id
    )
  END,
  CASE
    WHEN (sequence_number - 1) % 6 IN (1, 2) THEN root_ts
    ELSE NULL
  END,
  CASE WHEN (sequence_number - 1) % 6 = 0 THEN 2 ELSE 0 END,
  to_char(to_timestamp(epoch_seconds) AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
  CASE WHEN (sequence_number - 1) % 6 IN (1, 2) THEN 1 ELSE 0 END,
  CASE
    WHEN sequence_number = 12 THEN json_build_object('subtype', 'message_deleted')::text
    WHEN sequence_number = 18 THEN json_build_object(
      'subtype', 'bot_message',
      'bot_id', 'B0SYNTH001'
    )::text
    WHEN sequence_number = 20 THEN json_build_object('subtype', 'channel_join')::text
    WHEN sequence_number % 8 = 0 THEN json_build_object(
      'edited',
      json_build_object(
        'ts',
        (epoch_seconds + 30)::text || '.' || lpad(sequence_number::text, 6, '0')
      )
    )::text
    ELSE NULL
  END
FROM shaped
ORDER BY channel_index, sequence_number;

GRANT CONNECT ON DATABASE slack_archive TO archive_reader;
GRANT USAGE ON SCHEMA public TO archive_reader;
GRANT SELECT ON users, messages TO archive_reader;
