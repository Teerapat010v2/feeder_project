-- =======================================
-- SQL Schema for Smart Fish Feeder
-- =======================================

-- 1. Device State Table
CREATE TABLE IF NOT EXISTS device_state (
    device_id VARCHAR(50) PRIMARY KEY,
    online BOOLEAN DEFAULT false,
    feeding BOOLEAN DEFAULT false,
    weight NUMERIC DEFAULT 0,
    food_level VARCHAR(20) DEFAULT 'green',
    daily_usage NUMERIC DEFAULT 100,
    firmware VARCHAR(20),
    ip VARCHAR(20),
    wifi NUMERIC DEFAULT 0,
    feed_amount NUMERIC DEFAULT 10,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Feed History Table
CREATE TABLE IF NOT EXISTS feed_history (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    amount NUMERIC NOT NULL,
    mode VARCHAR(20) DEFAULT 'manual',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Alerts Table
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    level VARCHAR(20) DEFAULT 'info',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Schedules Table
CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    time VARCHAR(5) NOT NULL,
    amount NUMERIC DEFAULT 10,
    enable BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
