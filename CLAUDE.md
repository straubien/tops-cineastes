# Préférences de travail

- Ne jamais créer de nouvelle branche git, ni committer, ni pousser de commits, sauf demande explicite de l'utilisateur dans la conversation en cours.
- Pour toute modification de fichier demandée, ne pas toucher aux fichiers du repo : fournir les fichiers corrigés en téléchargement (via l'outil d'envoi de fichier) afin que l'utilisateur les remplace lui-même dans son repo.

# Conventions de données (Supabase)

## Table `cineastes`

- **`courant`, `courant2`, `courant3`, `courant4`** : l'ordre est **chronologique** et suit le déroulé de la carrière du cinéaste. Il ne traduit **aucune hiérarchie d'importance**. `courant` est le premier courant auquel le cinéaste a appartenu, pas son courant principal.

- **`pays`, `pays2`** : il s'agit des **pays de carrière**, dans l'**ordre chronologique**. Même règle : l'ordre ne traduit aucune hiérarchie d'importance. Ces champs alimentent les drapeaux affichés sur le site.

Ne jamais réordonner ces champs pour « remonter » un courant ou un pays jugé plus significatif : la position ne veut rien dire d'autre que l'antériorité.

## Rattachement d'un cinéaste à un courant

- **Le critère d'appartenance est le centre de gravité de la carrière, pas son point de départ.** Si le centre de gravité est dans le courant, celui-ci est un rattachement de plein droit. S'il est ailleurs, un passage substantiel — répété et délibéré, pas un ou deux titres isolés — justifie un rattachement, mais jamais en tant que **seul** courant du cinéaste : sinon la fiche le juge au lieu de le décrire.

- **Le courant qualifie une personne, pas un film.** Un film peut appartenir au cycle sans que son réalisateur appartienne au courant. Toujours vérifier qui a produit et distribué, pas seulement qui a signé.

- Le critère est **industriel et biographique, jamais évaluatif** : il ne sert pas à départager les auteurs des artisans.

- Ne proposer aucun nom antérieur à 1950 sans avoir vérifié la source : sur cette période les attributions de mémoire sont peu fiables.

- Ne pas proposer de nom en l'absence de consensus académique. Quand ce critère entre en conflit avec la cohérence interne d'une catégorie large (par exemple le bas de tableau du CINEMA BIS EUROPEEN), signaler le conflit au lieu de trancher seul.
