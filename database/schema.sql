CREATE DATABASE IF NOT EXISTS iv_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE iv_lab;

CREATE TABLE IF NOT EXISTS iv_lab_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iv_lab_admins (
  user_id INT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_iv_lab_admins_user
    FOREIGN KEY (user_id) REFERENCES iv_lab_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iv_lab_imports (
  id CHAR(36) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  data_year INT NOT NULL,
  record_count INT NOT NULL DEFAULT 0,
  skipped_province_count INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  imported_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_iv_lab_imports_created_at (created_at DESC),
  CONSTRAINT fk_iv_lab_imports_user
    FOREIGN KEY (imported_by) REFERENCES iv_lab_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iv_lab_records (
  id CHAR(36) PRIMARY KEY,
  registration_date DATE NOT NULL,
  kode_sampel VARCHAR(255) NOT NULL,
  nama_uji VARCHAR(255) NOT NULL,
  metode_uji VARCHAR(255) NOT NULL,
  interpretasi_hasil TEXT NULL,
  provinsi VARCHAR(255) NOT NULL,
  kabupaten VARCHAR(255) NULL,
  kecamatan VARCHAR(255) NULL,
  no_registrasi VARCHAR(255) NULL,
  sample_analysis_number VARCHAR(255) NULL,
  hewan VARCHAR(255) NULL,
  jenis_layanan VARCHAR(255) NULL,
  import_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_iv_lab_records_date (registration_date),
  INDEX idx_iv_lab_records_import_id (import_id),
  INDEX idx_iv_lab_records_provinsi (provinsi),
  INDEX idx_iv_lab_records_created_at (created_at DESC),
  CONSTRAINT fk_iv_lab_records_import
    FOREIGN KEY (import_id) REFERENCES iv_lab_imports (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iv_lab_sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  CONSTRAINT fk_iv_lab_sessions_user
    FOREIGN KEY (user_id) REFERENCES iv_lab_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
