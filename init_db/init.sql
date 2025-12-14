CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    push_token TEXT,
    preferrences JSONB DEFAULT '{"email": true, "push": true}',
    password_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- templates table
CREATE TABLE IF NOT EXISTS templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    version INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (code, version)  -- FIXED
);

-- notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id TEXT UNIQUE,

    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    template_id uuid REFERENCES templates(id) ON DELETE SET NULL,

    channel TEXT CHECK (channel IN ('email', 'push')),
    status TEXT CHECK (status IN ('pending', 'sent', 'failed')) DEFAULT 'pending',

    notification_type TEXT,
    template_code TEXT,
    variables JSONB,

    error TEXT,
    attempts INT DEFAULT 0,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
