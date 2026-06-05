CREATE TABLE IF NOT EXISTS credential_delivery (
  request_id INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  sent_at TIMESTAMPTZ
);
