-- Migration : création de la table cineastes
-- À exécuter dans le SQL Editor de Supabase

CREATE TABLE IF NOT EXISTS cineastes (
  id          SERIAL PRIMARY KEY,
  nom         TEXT NOT NULL UNIQUE,
  fbid        TEXT,
  url_facebook TEXT,
  duo         BOOLEAN NOT NULL DEFAULT FALSE,
  naissance   JSONB,    -- integer ou [int, int] pour les duos
  deces       JSONB,    -- integer, null, ou [int|null, int|null]
  vivant      JSONB,    -- boolean ou [bool, bool] pour les duos
  tops_contributeurs JSONB NOT NULL DEFAULT '[]'::JSONB
);

-- Index pour les recherches par nom (alphabétique)
CREATE INDEX IF NOT EXISTS idx_cineastes_nom ON cineastes (nom);

-- Autoriser la lecture publique (anon) en lecture seule
ALTER TABLE cineastes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lecture publique cineastes"
  ON cineastes FOR SELECT
  USING (true);
