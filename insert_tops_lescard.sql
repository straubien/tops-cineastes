-- Insertion directe des 7 tops de Grégory Lescard non reconnus par l'import automatique
-- (le 8e cas, SERIA Joël, est une absence silencieuse : aucun top n'existe réellement,
--  il faudra retirer "GREGORY LESCARD" de tops_contributeurs pour SERIA dans cineastes.json)

insert into submissions (contributor_id, raw_text, parsed_json, status)
select id,
  '1. La prochaine fois je viserai le coeur (2014)
2. L''amour est une fête (2018)
3. L''avocat (2011)',
  jsonb_build_object(
    'cineaste', 'ANGER, Cédric',
    'films', jsonb_build_array(
      jsonb_build_object('titre', 'La prochaine fois je viserai le coeur', 'annee', 2014),
      jsonb_build_object('titre', 'L''amour est une fête', 'annee', 2018),
      jsonb_build_object('titre', 'L''avocat', 'annee', 2011)
    )
  ),
  'approved'
from contributors where json_name = 'GREGORY LESCARD';

insert into submissions (contributor_id, raw_text, parsed_json, status)
select id,
  '1. Au revoir l''été (2013)
2. Harmonium (2016)',
  jsonb_build_object(
    'cineaste', 'FUKADA, Kôji',
    'films', jsonb_build_array(
      jsonb_build_object('titre', 'Au revoir l''été', 'annee', 2013),
      jsonb_build_object('titre', 'Harmonium', 'annee', 2016)
    )
  ),
  'approved'
from contributors where json_name = 'GREGORY LESCARD';

insert into submissions (contributor_id, raw_text, parsed_json, status)
select id,
  '1. La Sapienza (2015)
2. Le fils de Joseph (2016)
3. La religieuse portugaise (2009)
4. Le pont des Arts (2004)',
  jsonb_build_object(
    'cineaste', 'GREEN, Eugène',
    'films', jsonb_build_array(
      jsonb_build_object('titre', 'La Sapienza', 'annee', 2015),
      jsonb_build_object('titre', 'Le fils de Joseph', 'annee', 2016),
      jsonb_build_object('titre', 'La religieuse portugaise', 'annee', 2009),
      jsonb_build_object('titre', 'Le pont des Arts', 'annee', 2004)
    )
  ),
  'approved'
from contributors where json_name = 'GREGORY LESCARD';

insert into submissions (contributor_id, raw_text, parsed_json, status)
select id,
  '1. Kompromat (2022)
2. Anthony Zimmer (2005)
3. Largo Winch (2008)
4. Largo Winch 2 (2011)',
  jsonb_build_object(
    'cineaste', 'SALLE, Jérôme',
    'films', jsonb_build_array(
      jsonb_build_object('titre', 'Kompromat', 'annee', 2022),
      jsonb_build_object('titre', 'Anthony Zimmer', 'annee', 2005),
      jsonb_build_object('titre', 'Largo Winch', 'annee', 2008),
      jsonb_build_object('titre', 'Largo Winch 2', 'annee', 2011)
    )
  ),
  'approved'
from contributors where json_name = 'GREGORY LESCARD';

insert into submissions (contributor_id, raw_text, parsed_json, status)
select id,
  '1. Scène de crimes (2000)
2. 96 heures (2014)
3. Switch (2011)
4. Agents secrets (2004)
5. Le convoi (2016)
6. Truands (2007)',
  jsonb_build_object(
    'cineaste', 'SCHOENDOERFFER, Frédéric',
    'films', jsonb_build_array(
      jsonb_build_object('titre', 'Scène de crimes', 'annee', 2000),
      jsonb_build_object('titre', '96 heures', 'annee', 2014),
      jsonb_build_object('titre', 'Switch', 'annee', 2011),
      jsonb_build_object('titre', 'Agents secrets', 'annee', 2004),
      jsonb_build_object('titre', 'Le convoi', 'annee', 2016),
      jsonb_build_object('titre', 'Truands', 'annee', 2007)
    )
  ),
  'approved'
from contributors where json_name = 'GREGORY LESCARD';

insert into submissions (contributor_id, raw_text, parsed_json, status)
select id,
  '1. Naissance des pieuvres (2007)
2. Tomboy (2011)
3. Portrait de la jeune fille en feu (2019)
4. Bande de filles (2014)
5. Petite maman (2021)',
  jsonb_build_object(
    'cineaste', 'SCIAMMA, Céline',
    'films', jsonb_build_array(
      jsonb_build_object('titre', 'Naissance des pieuvres', 'annee', 2007),
      jsonb_build_object('titre', 'Tomboy', 'annee', 2011),
      jsonb_build_object('titre', 'Portrait de la jeune fille en feu', 'annee', 2019),
      jsonb_build_object('titre', 'Bande de filles', 'annee', 2014),
      jsonb_build_object('titre', 'Petite maman', 'annee', 2021)
    )
  ),
  'approved'
from contributors where json_name = 'GREGORY LESCARD';

insert into submissions (contributor_id, raw_text, parsed_json, status)
select id,
  '1. Eternals (2021)
2. Nomadland (2020)',
  jsonb_build_object(
    'cineaste', 'ZHAO, Chloé',
    'films', jsonb_build_array(
      jsonb_build_object('titre', 'Eternals', 'annee', 2021),
      jsonb_build_object('titre', 'Nomadland', 'annee', 2020)
    )
  ),
  'approved'
from contributors where json_name = 'GREGORY LESCARD';
