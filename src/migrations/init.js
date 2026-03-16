// src/migrations/init.js
require('dotenv').config();
const pool = require('../../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 Initialisation de la base de données...');

    // Extension
    // await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // Table users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        nom         VARCHAR(100) NOT NULL,
        email       VARCHAR(150) UNIQUE NOT NULL,
        password    VARCHAR(255) NOT NULL,
        role        VARCHAR(20) DEFAULT 'commercial' CHECK (role IN ('admin','commercial','manager')),
        actif       BOOLEAN DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        last_login  TIMESTAMPTZ
      )
    `);

    // Table prospects
    await client.query(`
      CREATE TABLE IF NOT EXISTS prospects (
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
        created_by    INTEGER REFERENCES users(id),
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Table prospect_history
    await client.query(`
      CREATE TABLE IF NOT EXISTS prospect_history (
        id          SERIAL PRIMARY KEY,
        prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        status      VARCHAR(50) NOT NULL,
        comment     TEXT,
        changed_by  INTEGER REFERENCES users(id),
        changed_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Table objectifs
    await client.query(`
      CREATE TABLE IF NOT EXISTS objectifs (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
        mois            INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
        annee           INTEGER NOT NULL,
        obj_prospection INTEGER DEFAULT 30,
        obj_closing     INTEGER DEFAULT 5,
        obj_ca          NUMERIC(15,2) DEFAULT 5000000,
        UNIQUE(user_id, mois, annee)
      )
    `);

    // Index via DO block
    await client.query(`
      DO $body$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_prospects_status') THEN
          CREATE INDEX idx_prospects_status ON prospects(status);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_prospects_sector') THEN
          CREATE INDEX idx_prospects_sector ON prospects(sector);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_prospects_created') THEN
          CREATE INDEX idx_prospects_created ON prospects(created_at);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_history_prospect') THEN
          CREATE INDEX idx_history_prospect ON prospect_history(prospect_id);
        END IF;
      END
      $body$
    `);

    // Trigger updated_at via DO block (évite CREATE OR REPLACE FUNCTION)
    await client.query(`
      DO $body$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
          EXECUTE $func$
            CREATE FUNCTION update_updated_at()
            RETURNS TRIGGER LANGUAGE plpgsql AS $inner$
            BEGIN
              NEW.updated_at = NOW();
              RETURN NEW;
            END
            $inner$
          $func$;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at') THEN
          CREATE TRIGGER set_updated_at
            BEFORE UPDATE ON prospects
            FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
        END IF;
      END
      $body$
    `);

    // Séquence track_id
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS track_id_seq START 1001
    `);

    console.log('✅ Tables créées avec succès.');

    // Admin par défaut
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('Admin@2025', 10);
    await client.query(`
      INSERT INTO users (nom, email, password, role)
      VALUES ('Administrateur', 'admin@prospect-crm.com', $1, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [hash]);

    console.log('👤 Compte admin créé : admin@prospect-crm.com / Admin@2025');
    console.log('   ⚠️  Changez le mot de passe après la première connexion !');

  } catch (err) {
    console.error('❌ Erreur migration :', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();