-- Insertion directe des 7 tops de Grégory Lescard non reconnus par l'import automatique
-- dans la table legacy "tops" (contributor_id, cineaste_nom, films jsonb[])
-- (le 8e cas, SERIA Joël, est une absence silencieuse : aucun top n'existe réellement,
--  il faudra retirer "GREGORY LESCARD" de tops_contributeurs pour SERIA dans cineastes.json)

insert into tops (contributor_id, cineaste_nom, films)
select id, 'ANGER, Cédric',
  jsonb_build_array(
    jsonb_build_object('titre', 'La prochaine fois je viserai le coeur', 'annee', 2014),
    jsonb_build_object('titre', 'L''amour est une fête', 'annee', 2018),
    jsonb_build_object('titre', 'L''avocat', 'annee', 2011)
  )
from contributors where json_name = 'GREGORY LESCARD';

insert into tops (contributor_id, cineaste_nom, films)
select id, 'FUKADA, Kôji',
  jsonb_build_array(
    jsonb_build_object('titre', 'Au revoir l''été', 'annee', 2013),
    jsonb_build_object('titre', 'Harmonium', 'annee', 2016)
  )
from contributors where json_name = 'GREGORY LESCARD';

insert into tops (contributor_id, cineaste_nom, films)
select id, 'GREEN, Eugène',
  jsonb_build_array(
    jsonb_build_object('titre', 'La Sapienza', 'annee', 2015),
    jsonb_build_object('titre', 'Le fils de Joseph', 'annee', 2016),
    jsonb_build_object('titre', 'La religieuse portugaise', 'annee', 2009),
    jsonb_build_object('titre', 'Le pont des Arts', 'annee', 2004)
  )
from contributors where json_name = 'GREGORY LESCARD';

insert into tops (contributor_id, cineaste_nom, films)
select id, 'SALLE, Jérôme',
  jsonb_build_array(
    jsonb_build_object('titre', 'Kompromat', 'annee', 2022),
    jsonb_build_object('titre', 'Anthony Zimmer', 'annee', 2005),
    jsonb_build_object('titre', 'Largo Winch', 'annee', 2008),
    jsonb_build_object('titre', 'Largo Winch 2', 'annee', 2011)
  )
from contributors where json_name = 'GREGORY LESCARD';

insert into tops (contributor_id, cineaste_nom, films)
select id, 'SCHOENDOERFFER, Frédéric',
  jsonb_build_array(
    jsonb_build_object('titre', 'Scène de crimes', 'annee', 2000),
    jsonb_build_object('titre', '96 heures', 'annee', 2014),
    jsonb_build_object('titre', 'Switch', 'annee', 2011),
    jsonb_build_object('titre', 'Agents secrets', 'annee', 2004),
    jsonb_build_object('titre', 'Le convoi', 'annee', 2016),
    jsonb_build_object('titre', 'Truands', 'annee', 2007)
  )
from contributors where json_name = 'GREGORY LESCARD';

insert into tops (contributor_id, cineaste_nom, films)
select id, 'SCIAMMA, Céline',
  jsonb_build_array(
    jsonb_build_object('titre', 'Naissance des pieuvres', 'annee', 2007),
    jsonb_build_object('titre', 'Tomboy', 'annee', 2011),
    jsonb_build_object('titre', 'Portrait de la jeune fille en feu', 'annee', 2019),
    jsonb_build_object('titre', 'Bande de filles', 'annee', 2014),
    jsonb_build_object('titre', 'Petite maman', 'annee', 2021)
  )
from contributors where json_name = 'GREGORY LESCARD';

insert into tops (contributor_id, cineaste_nom, films)
select id, 'ZHAO, Chloé',
  jsonb_build_array(
    jsonb_build_object('titre', 'Eternals', 'annee', 2021),
    jsonb_build_object('titre', 'Nomadland', 'annee', 2020)
  )
from contributors where json_name = 'GREGORY LESCARD';
