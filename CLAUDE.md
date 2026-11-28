# Préférences de travail

- Ne jamais créer de nouvelle branche git, ni committer, ni pousser de commits, sauf demande explicite de l'utilisateur dans la conversation en cours.
- Pour toute modification de fichier demandée, ne pas toucher aux fichiers du repo : fournir les fichiers corrigés en téléchargement (via l'outil d'envoi de fichier) afin que l'utilisateur les remplace lui-même dans son repo.

# Conventions de données (Supabase)

## Table `cineastes`

- **`courant`, `courant2`, `courant3`, `courant4`** : l'ordre est **chronologique** et suit le déroulé de la carrière du cinéaste. Il ne traduit **aucune hiérarchie d'importance**. `courant` est le premier courant auquel le cinéaste a appartenu, pas son courant principal.

- **`pays`, `pays2`** : il s'agit des **pays de carrière**, dans l'**ordre chronologique**. Même règle : l'ordre ne traduit aucune hiérarchie d'importance. Ces champs alimentent les drapeaux affichés sur le site.

Ne jamais réordonner ces champs pour « remonter » un courant ou un pays jugé plus significatif : la position ne veut rien dire d'autre que l'antériorité.
