-- =============================================================================
-- TRAVION — MySQL schema for `travion_db`
-- =============================================================================
-- GENERATED FILE — do not edit by hand.
-- Source of truth: backend/app/models/entities.py
-- Regenerate:      cd backend && python scripts/generate_schema_sql.py
--
-- How to use (MySQL Workbench):
--   1. Create the schema first:  CREATE DATABASE IF NOT EXISTS `travion_db`
--        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   2. Select it as the default schema in the connected session (schemas panel).
--   3. Run this script (File > Run SQL Script, or Ctrl+Shift+R).
--   4. Verify with:  SHOW TABLES;   and the EER diagram (Database > Reverse Engineer).
--
-- Notes
--   * Character set: utf8mb4 / utf8mb4_unicode_ci (full Unicode, emoji-safe).
--   * Engine: InnoDB (foreign keys, transactions, row-level locking).
--   * Money columns: DECIMAL(12,2) — exact base-10 arithmetic, never FLOAT.
--   * Coordinates: DOUBLE — scientific values, not money.
--   * Timestamps: DATETIME stored in UTC; the application converts for display.
--   * The backend additionally applies additive startup migrations
--     (app/main.py::_ensure_runtime_columns) — this file is the full baseline.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;



CREATE TABLE IF NOT EXISTS audit_logs (
	id VARCHAR(36) NOT NULL, 
	action VARCHAR(100) NOT NULL, 
	actor_email VARCHAR(255) NOT NULL, 
	actor_role VARCHAR(50) NOT NULL, 
	target_id VARCHAR(100), 
	details JSON, 
	created_at DATETIME, 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS contact_messages (
	id VARCHAR(36) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	topic VARCHAR(50) NOT NULL, 
	priority VARCHAR(20) NOT NULL, 
	message TEXT NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	created_at DATETIME, 
	handled_at DATETIME, 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX ix_contact_messages_email ON contact_messages (email);


CREATE TABLE IF NOT EXISTS identities (
	id VARCHAR(36) NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	hashed_password VARCHAR(255) NOT NULL, 
	`role` VARCHAR(50) NOT NULL, 
	is_active BOOL, 
	created_at DATETIME, 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX ix_identities_email ON identities (email);


CREATE TABLE IF NOT EXISTS locations (
	id VARCHAR(36) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	state VARCHAR(100) NOT NULL, 
	country VARCHAR(100), 
	lat DOUBLE PRECISION NOT NULL, 
	lng DOUBLE PRECISION NOT NULL, 
	place_id VARCHAR(255), 
	description TEXT, 
	hero_image VARCHAR(500), 
	popular_season VARCHAR(100), 
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX ix_locations_name ON locations (name);

CREATE INDEX ix_locations_place_id ON locations (place_id);


CREATE TABLE IF NOT EXISTS admins (
	id VARCHAR(36) NOT NULL, 
	identity_id VARCHAR(36) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (identity_id), 
	FOREIGN KEY(identity_id) REFERENCES identities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS guides (
	id VARCHAR(36) NOT NULL, 
	identity_id VARCHAR(36) NOT NULL, 
	first_name VARCHAR(100) NOT NULL, 
	last_name VARCHAR(100) NOT NULL, 
	photo_url VARCHAR(500), 
	phone VARCHAR(50), 
	status VARCHAR(50), 
	approval_status VARCHAR(50), 
	languages JSON, 
	destinations JSON, 
	experience_years INTEGER, 
	specializations JSON, 
	destination_knowledge TEXT, 
	safety_information TEXT, 
	rating FLOAT, 
	review_count INTEGER, 
	rate_per_day NUMERIC(12, 2), 
	current_trip_id VARCHAR(36), 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (identity_id), 
	FOREIGN KEY(identity_id) REFERENCES identities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS managers (
	id VARCHAR(36) NOT NULL, 
	identity_id VARCHAR(36) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	department VARCHAR(100), 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (identity_id), 
	FOREIGN KEY(identity_id) REFERENCES identities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS users (
	id VARCHAR(36) NOT NULL, 
	identity_id VARCHAR(36) NOT NULL, 
	first_name VARCHAR(100), 
	last_name VARCHAR(100), 
	preferred_name VARCHAR(100), 
	photo_url VARCHAR(500), 
	age INTEGER, 
	gender VARCHAR(50), 
	preferred_language VARCHAR(50), 
	additional_languages JSON, 
	country VARCHAR(100), 
	home_city VARCHAR(100), 
	phone VARCHAR(50), 
	preferred_communication VARCHAR(50), 
	emergency_contact_name VARCHAR(100), 
	emergency_contact_phone VARCHAR(50), 
	is_profile_complete BOOL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (identity_id), 
	FOREIGN KEY(identity_id) REFERENCES identities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS trips (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	source_location_id VARCHAR(36) NOT NULL, 
	destination_location_id VARCHAR(36) NOT NULL, 
	source_name VARCHAR(100) NOT NULL, 
	destination_name VARCHAR(100) NOT NULL, 
	start_datetime DATETIME NOT NULL, 
	end_datetime DATETIME NOT NULL, 
	status VARCHAR(50), 
	mode VARCHAR(50), 
	budget NUMERIC(12, 2), 
	total_cost NUMERIC(12, 2), 
	created_at DATETIME, 
	updated_at DATETIME, 
	current_stage INTEGER DEFAULT 1, 
	stage_history JSON, 
	transport_options JSON, 
	selected_transport JSON, 
	local_transport JSON, 
	food_tier VARCHAR(16) DEFAULT 'STANDARD', 
	weather JSON, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(source_location_id) REFERENCES locations (id), 
	FOREIGN KEY(destination_location_id) REFERENCES locations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS budget_adjustments (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	actor_id VARCHAR(36), 
	actor_email VARCHAR(255) NOT NULL, 
	actor_role VARCHAR(50) NOT NULL, 
	previous_budget NUMERIC(12, 2) NOT NULL, 
	adjustment_amount NUMERIC(12, 2) NOT NULL, 
	updated_budget NUMERIC(12, 2) NOT NULL, 
	currency VARCHAR(10) NOT NULL, 
	stage VARCHAR(32) NOT NULL, 
	reason VARCHAR(255), 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX ix_budget_adjustments_trip_id ON budget_adjustments (trip_id);


CREATE TABLE IF NOT EXISTS chat_messages (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	sender_role VARCHAR(50) NOT NULL, 
	sender_id VARCHAR(36) NOT NULL, 
	sender_name VARCHAR(100) NOT NULL, 
	message TEXT NOT NULL, 
	channel VARCHAR(50), 
	lat DOUBLE PRECISION, 
	lng DOUBLE PRECISION, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS guide_assignments (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	guide_id VARCHAR(36), 
	manager_id VARCHAR(36), 
	status VARCHAR(50), 
	match_score FLOAT, 
	match_breakdown JSON, 
	requested_at DATETIME, 
	confirmed_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (trip_id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id), 
	FOREIGN KEY(guide_id) REFERENCES guides (id), 
	FOREIGN KEY(manager_id) REFERENCES managers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS itineraries (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	version INTEGER, 
	is_active BOOL, 
	total_cost NUMERIC(12, 2), 
	days_data JSON, 
	cost_breakdown JSON, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS offline_packages (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	package_data JSON NOT NULL, 
	generated_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (trip_id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS payments (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	razorpay_order_id VARCHAR(100) NOT NULL, 
	razorpay_payment_id VARCHAR(100), 
	razorpay_signature VARCHAR(255), 
	status VARCHAR(50), 
	total_amount NUMERIC(12, 2) NOT NULL, 
	currency VARCHAR(10), 
	non_refundable_acknowledged BOOL NOT NULL, 
	acknowledged_at DATETIME, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (trip_id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS plan_change_logs (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	version INTEGER NOT NULL, 
	change_type VARCHAR(32) NOT NULL, 
	summary TEXT NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX ix_plan_change_logs_trip_id ON plan_change_logs (trip_id);


CREATE TABLE IF NOT EXISTS replanning_logs (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	trigger_type VARCHAR(50) NOT NULL, 
	reason VARCHAR(255) NOT NULL, 
	explanation TEXT NOT NULL, 
	old_version INTEGER NOT NULL, 
	new_version INTEGER NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS reviews (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	guide_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	user_name VARCHAR(100), 
	rating INTEGER NOT NULL, 
	comment TEXT, 
	is_visible_on_profile BOOL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id), 
	FOREIGN KEY(guide_id) REFERENCES guides (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS trip_place_selections (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	provider_place_id VARCHAR(255) NOT NULL, 
	place_id VARCHAR(255), 
	name VARCHAR(255) NOT NULL, 
	category VARCHAR(50) NOT NULL, 
	latitude DOUBLE PRECISION, 
	longitude DOUBLE PRECISION, 
	distance_km FLOAT, 
	rating FLOAT, 
	price NUMERIC(12, 2), 
	item_json JSON, 
	selection_source VARCHAR(32), 
	status VARCHAR(20), 
	selected_at DATETIME, 
	removed_at DATETIME, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_trip_place_selection UNIQUE (trip_id, provider_place_id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX ix_trip_place_selections_trip_id ON trip_place_selections (trip_id);

CREATE INDEX ix_trip_place_selections_user_id ON trip_place_selections (user_id);


CREATE TABLE IF NOT EXISTS trip_profiles (
	id VARCHAR(36) NOT NULL, 
	trip_id VARCHAR(36) NOT NULL, 
	questions_answers JSON, 
	party_type VARCHAR(50), 
	experience_type VARCHAR(50), 
	food_pref VARCHAR(50), 
	stay_pref VARCHAR(50), 
	transport_pref VARCHAR(50), 
	walking_tolerance VARCHAR(50), 
	language VARCHAR(50), 
	specific_places JSON, 
	priority VARCHAR(50), 
	selected_stay JSON, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (trip_id), 
	FOREIGN KEY(trip_id) REFERENCES trips (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS payment_splits (
	id VARCHAR(36) NOT NULL, 
	payment_id VARCHAR(36) NOT NULL, 
	transport_cost NUMERIC(12, 2), 
	stay_cost NUMERIC(12, 2), 
	food_cost NUMERIC(12, 2), 
	activity_cost NUMERIC(12, 2), 
	guide_fee NUMERIC(12, 2), 
	platform_fee NUMERIC(12, 2), 
	safety_reserve NUMERIC(12, 2), 
	insurance_fee NUMERIC(12, 2), 
	settlement_status VARCHAR(50), 
	settled_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (payment_id), 
	FOREIGN KEY(payment_id) REFERENCES payments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


SET FOREIGN_KEY_CHECKS = 1;
