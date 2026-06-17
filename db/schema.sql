-- 城市智慧停车运营管理平台 表结构（全程 utf8mb4，确保中文正常）
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(64) NOT NULL,
  role          VARCHAR(16) NOT NULL DEFAULT 'VIEWER',
  status        VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_lots (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code          VARCHAR(32) NOT NULL UNIQUE,
  name          VARCHAR(128) NOT NULL,
  district      VARCHAR(64) NOT NULL,
  address       VARCHAR(255) NOT NULL DEFAULT '',
  total_spaces  INT NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_spaces (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lot_id      INT UNSIGNED NOT NULL,
  code        VARCHAR(32) NOT NULL,
  type        VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
  status      VARCHAR(16) NOT NULL DEFAULT 'FREE',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_lot_space (lot_id, code),
  CONSTRAINT fk_space_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  plate_no     VARCHAR(16) NOT NULL UNIQUE,
  owner_name   VARCHAR(64) NOT NULL DEFAULT '',
  phone        VARCHAR(32) NOT NULL DEFAULT '',
  vehicle_type VARCHAR(16) NOT NULL DEFAULT 'SMALL',
  is_member    TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_sessions (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lot_id      INT UNSIGNED NOT NULL,
  space_id    INT UNSIGNED NULL,
  plate_no    VARCHAR(16) NOT NULL,
  enter_time  DATETIME(3) NOT NULL,
  exit_time   DATETIME(3) NULL,
  fee_cents   INT NOT NULL DEFAULT 0,
  status      VARCHAR(16) NOT NULL DEFAULT 'PARKED',
  paid        TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_session_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE SET NULL,
  INDEX idx_session_status (status),
  INDEX idx_session_plate (plate_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ===== 月卡模块 ===== */

CREATE TABLE IF NOT EXISTS monthly_cards (
  id                INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  card_no           VARCHAR(32) NOT NULL UNIQUE,
  name              VARCHAR(128) NOT NULL DEFAULT '',
  card_type         VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
  scope_type        VARCHAR(16) NOT NULL DEFAULT 'SINGLE_LOT',
  price_cents       INT NOT NULL DEFAULT 0,
  duration_days     INT NOT NULL DEFAULT 30,
  free_slots        JSON NULL,
  max_vehicles      INT NOT NULL DEFAULT 1,
  concurrent_quota  INT NOT NULL DEFAULT 0,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  status            VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  owner_name        VARCHAR(64) NOT NULL DEFAULT '',
  phone             VARCHAR(32) NOT NULL DEFAULT '',
  refunded_cents    INT NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_card_status (status),
  INDEX idx_card_dates (start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monthly_card_vehicles (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  card_id     INT UNSIGNED NOT NULL,
  plate_no    VARCHAR(16) NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_card_plate (card_id, plate_no),
  INDEX idx_plate (plate_no),
  CONSTRAINT fk_mcv_card FOREIGN KEY (card_id) REFERENCES monthly_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monthly_card_scopes (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  card_id     INT UNSIGNED NOT NULL,
  lot_id      INT UNSIGNED NULL,
  district    VARCHAR(64) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_mcs_card FOREIGN KEY (card_id) REFERENCES monthly_cards(id) ON DELETE CASCADE,
  CONSTRAINT fk_mcs_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE SET NULL,
  INDEX idx_card (card_id),
  INDEX idx_lot (lot_id),
  INDEX idx_district (district)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monthly_card_transactions (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  card_id     INT UNSIGNED NOT NULL,
  trans_type  VARCHAR(16) NOT NULL,
  amount_cents INT NOT NULL DEFAULT 0,
  days        INT NOT NULL DEFAULT 0,
  operator    VARCHAR(64) NOT NULL DEFAULT '',
  remark      VARCHAR(255) NOT NULL DEFAULT '',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_mct_card FOREIGN KEY (card_id) REFERENCES monthly_cards(id) ON DELETE CASCADE,
  INDEX idx_card (card_id),
  INDEX idx_type (trans_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ===== 套餐模块 ===== */

CREATE TABLE IF NOT EXISTS packages (
  id                    INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  package_no            VARCHAR(32) NOT NULL UNIQUE,
  name                  VARCHAR(128) NOT NULL DEFAULT '',
  package_type          VARCHAR(16) NOT NULL DEFAULT 'TIMES',
  plate_no              VARCHAR(16) NOT NULL,
  total_amount_cents    INT NOT NULL DEFAULT 0,
  remaining_amount_cents INT NOT NULL DEFAULT 0,
  total_times           INT NOT NULL DEFAULT 0,
  remaining_times       INT NOT NULL DEFAULT 0,
  total_minutes         INT NOT NULL DEFAULT 0,
  remaining_minutes     INT NOT NULL DEFAULT 0,
  purchased_at          DATETIME(3) NOT NULL,
  expires_at            DATETIME(3) NULL,
  status                VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_plate (plate_no),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ===== 抵扣流水 ===== */

CREATE TABLE IF NOT EXISTS deduction_records (
  id                  INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  session_id          INT UNSIGNED NULL,
  plate_no            VARCHAR(16) NOT NULL,
  source_type         VARCHAR(16) NOT NULL,
  source_id           INT UNSIGNED NOT NULL,
  free_minutes        INT NOT NULL DEFAULT 0,
  deducted_minutes    INT NOT NULL DEFAULT 0,
  deducted_times      INT NOT NULL DEFAULT 0,
  deducted_cents      INT NOT NULL DEFAULT 0,
  paid_cents          INT NOT NULL DEFAULT 0,
  breakdown           JSON NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_session (session_id),
  INDEX idx_plate (plate_no),
  INDEX idx_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
