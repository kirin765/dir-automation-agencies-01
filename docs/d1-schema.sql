CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  city TEXT,
  city_country_key TEXT,
  country TEXT,
  platforms TEXT,
  description TEXT,
  price_min INTEGER,
  price_max INTEGER,
  rating REAL,
  review_count INTEGER,
  featured INTEGER DEFAULT 0,
  featured_until TEXT,
  featured_score INTEGER DEFAULT 0,
  featured_active INTEGER DEFAULT 0,
  verified INTEGER DEFAULT 0,
  source TEXT DEFAULT 'seed_generated',
  source_ref TEXT,
  verification_method TEXT DEFAULT 'none',
  verified_at TEXT,
  priority_score INTEGER DEFAULT 0,
  website TEXT,
  email TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lead_submissions (
  id TEXT PRIMARY KEY,
  listing_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  budget TEXT,
  message TEXT NOT NULL,
  source_page TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ownership_requests (
  id TEXT PRIMARY KEY,
  listing_slug TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  website TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_page TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS join_agency_requests (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  platforms TEXT NOT NULL,
  website TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  verification_evidence TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_page TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  listing_slug TEXT,
  source_page TEXT,
  target TEXT,
  metadata TEXT,
  source_ip TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listings_country ON listings(country);
CREATE INDEX IF NOT EXISTS idx_listings_featured ON listings(featured, featured_until);
CREATE INDEX IF NOT EXISTS idx_listings_featured_active ON listings(featured_active, featured_until);
CREATE INDEX IF NOT EXISTS idx_lead_status ON lead_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ownership_status ON ownership_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_join_request_status ON join_agency_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_join_request_website ON join_agency_requests(website);
CREATE INDEX IF NOT EXISTS idx_join_request_contact_email ON join_agency_requests(contact_email);
CREATE INDEX IF NOT EXISTS idx_tracking_event_type ON tracking_events(event_type, created_at);
