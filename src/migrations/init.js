// src/migrations/init.js
// Exécuter une seule fois : node src/migrations/init.js
require('dotenv').config();
const pool = require('../../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 Initialisation de la base de données (multi-tenant)...');

    // ── Nettoyage complet ───────────────────────────────────────────
    await client.query(`
      DROP TABLE IF EXISTS prospect_history CASCADE;
      DROP TABLE IF EXISTS objectifs        CASCADE;
      DROP TABLE IF EXISTS prospects        CASCADE;
      DROP TABLE IF EXISTS users            CASCADE;
      DROP TABLE IF EXISTS companies        CASCADE;
      DROP SEQUENCE IF EXISTS track_id_seq;
    `);

    // ── Extension UUID ───────────────────────────────────────────────
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // ── TABLE COMPANIES ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE companies (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(200) NOT NULL,
        slug       VARCHAR(100) UNIQUE NOT NULL,
        actif      BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── TABLE UTILISATEURS ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE users (
        id         SERIAL PRIMARY KEY,
        nom        VARCHAR(100) NOT NULL,
        email      VARCHAR(150) UNIQUE NOT NULL,
        password   VARCHAR(255) NOT NULL,
        role       VARCHAR(20) DEFAULT 'commercial'
                   CHECK (role IN ('superadmin','admin','commercial','manager')),
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        actif      BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
      );
    `);

    // ── TABLE PROSPECTS ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE prospects (
        id            SERIAL PRIMARY KEY,
        track_id      VARCHAR(20) UNIQUE NOT NULL,
        company       VARCHAR(200) NOT NULL,
        sector        VARCHAR(100) NOT NULL,
        keyperson     VARCHAR(150) NOT NULL,
        poste         VARCHAR(100),
        tel           VARCHAR(50),
        email         VARCHAR(150),
        location      VARCHAR(200) NOT NULL,
        size          VARCHAR(50),
        status        VARCHAR(50) DEFAULT 'Prospection',
        source        VARCHAR(100),
        priority      VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
        ca_potentiel  NUMERIC(15,2) DEFAULT 0,
        next_action   TEXT,
        next_date     DATE,
        expected      TEXT,
        obtained      TEXT,
        comment       TEXT,
        need          TEXT,
        company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        created_by    INTEGER REFERENCES users(id),
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── TABLE HISTORIQUE DES STATUTS ─────────────────────────────────
    await client.query(`
      CREATE TABLE prospect_history (
        id          SERIAL PRIMARY KEY,
        prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        status      VARCHAR(50) NOT NULL,
        comment     TEXT,
        changed_by  INTEGER REFERENCES users(id),
        changed_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── TABLE OBJECTIFS ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE objectifs (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        mois            INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
        annee           INTEGER NOT NULL,
        obj_prospection INTEGER DEFAULT 30,
        obj_closing     INTEGER DEFAULT 5,
        obj_ca          NUMERIC(15,2) DEFAULT 5000000,
        UNIQUE(user_id, mois, annee)
      );
    `);

    // ── INDEX ────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX idx_prospects_status  ON prospects(status);
      CREATE INDEX idx_prospects_sector  ON prospects(sector);
      CREATE INDEX idx_prospects_created ON prospects(created_at);
      CREATE INDEX idx_prospects_company ON prospects(company_id);
      CREATE INDEX idx_users_company     ON users(company_id);
      CREATE INDEX idx_history_prospect  ON prospect_history(prospect_id);
    `);

    // ── TRIGGER updated_at ───────────────────────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON prospects
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    `);

    // ── SÉQUENCE track_id ────────────────────────────────────────────
    await client.query(`CREATE SEQUENCE track_id_seq START 1001;`);

    console.log('✅ Tables créées avec succès.');

    // ── SEED : Super Admin ───────────────────────────────────────────
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('SuperAdmin@2025', 10);
    await client.query(`
      INSERT INTO users (nom, email, password, role, company_id)
      VALUES ('Super Administrateur', 'superadmin@prospect-crm.com', $1, 'superadmin', NULL)
      ON CONFLICT (email) DO NOTHING;
    `, [hash]);
    console.log('👤 Compte superadmin créé : superadmin@prospect-crm.com / SuperAdmin@2025');
    console.log('   ⚠️  Changez le mot de passe après la première connexion !');

  } catch (err) {
    console.error('❌ Erreur migration :', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
