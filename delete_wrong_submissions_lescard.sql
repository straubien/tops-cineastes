-- Supprime les 7 lignes insérées par erreur dans "submissions" (au lieu de "tops")
-- pour Grégory Lescard sur ANGER, FUKADA, GREEN, SALLE, SCHOENDOERFFER, SCIAMMA, ZHAO

delete from submissions
where contributor_id = (select id from contributors where json_name = 'GREGORY LESCARD')
  and status = 'approved'
  and parsed_json->>'cineaste' in (
    'ANGER, Cédric',
    'FUKADA, Kôji',
    'GREEN, Eugène',
    'SALLE, Jérôme',
    'SCHOENDOERFFER, Frédéric',
    'SCIAMMA, Céline',
    'ZHAO, Chloé'
  );
