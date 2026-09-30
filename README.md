# TOPS / CINÉASTES

Index collaboratif de « tops cinéastes » — des classements de films par réalisateur, proposés par des cinéphiles.

**En ligne :** <https://straubien.github.io/tops-cineastes/>

---

## En deux mots, comment ça marche

Le site est **statique** : GitHub Pages sert des fichiers, sans serveur applicatif. Tout le contenu est assemblé dans le navigateur du visiteur, à partir de trois sources :

1. **Supabase** — la base de données (cinéastes, cinéphiles, tops soumis, commentaires, courants).
2. **`muzard.json` et `cnudde.json`** — deux collections de tops importées à la main, servies comme fichiers.
3. **`portraits/`, `themes/`, `flags/`** — les images, en repli quand TMDB n'a pas de photo.

Il n'y a **ni compilation, ni assemblage** : les fichiers du dépôt sont exactement ceux que reçoit le navigateur. Publier = pousser sur `main`.

---

## Les fichiers

### Les trois pages

| Fichier | Rôle |
|---|---|
| `index.html` + `index.js` | Le site public : index des cinéastes, fiches, profils, actualités, statistiques, tops thématiques, « mes tops », comparateur |
| `submit.html` + `submit.js` | L'espace contributeur : profil, avatar, films et cinéastes favoris, présentation |
| `admin.html` + `admin.js` | Le back-office : modération des soumissions, propositions, édition des fiches, réglages |

### Les fichiers partagés

| Fichier | Rôle | Chargé par |
|---|---|---|
| `config.js` | Adresse et clé publique Supabase, fabrique du client | les 3 pages |
| `utils.js` | Fonctions communes : analyseurs de listes, noms, portraits, erreurs, accessibilité | les 3 pages |
| `shared.js` | Mode sombre (avant le premier affichage), bannières, erreurs globales, détection hors-ligne | les 3 pages |
| `i18n.js` | Traductions français/anglais et fonction `t()` | index + submit |
| `flagsdata.js` | Drapeaux et libellés de pays | index + admin |
| `auth-shared.js` | Connexion Supabase mutualisée | submit + admin |
| `anti-cadre.js` | Garde-fou contre l'affichage du site dans un cadre | submit + admin |
| `style.css` | Tout le style, thèmes clair et sombre | les 3 pages |
| `sw.js` | Service worker : met en cache les deux fichiers de tops | index |

### Les outils (non publiés)

Jekyll ne publie pas les dossiers commençant par un tiret bas.

| Fichier | Rôle |
|---|---|
| `_outils/verifier-json.py` | Contrôle de `muzard.json` et `cnudde.json` |
| `_outils/og-image.html` | Gabarit servant à fabriquer `og-image.png` (l'image de partage) par capture d'écran, en 2400×1260 |

---

## Publier

Poussez sur `main`. GitHub Pages reconstruit et met en ligne en une à deux minutes.

**Vous n'avez aucun numéro de version à incrémenter.** Le `?v=…` des balises `<script>` et `<link>` est calculé automatiquement par Jekyll à partir de l'heure de construction (`_config.yml`). Chaque publication produit un numéro neuf, donc les visiteurs de retour reçoivent toujours les fichiers à jour.

> ⚠️ **Évitez d'enchaîner plusieurs envois en moins d'une minute.** GitHub Pages lance une construction par envoi ; quand elles se chevauchent, l'une peut échouer avec le message *« Multiple artifacts named github-pages »*. Si ça arrive : onglet **Actions**, ouvrez la construction en échec, **Re-run all jobs**.

---

## Les contrôles automatiques

Deux contrôles tournent à chaque envoi. **Aucun ne bloque la mise en ligne** : GitHub Pages publie en parallèle. Ils vous préviennent par courriel si quelque chose casse.

| Contrôle | Se déclenche sur | Ce qu'il vérifie |
|---|---|---|
| `verifier-les-json.yml` | `muzard.json`, `cnudde.json` | Structure des fichiers, chute du nombre de tops, numéro de version oublié |
| `verifier-le-js.yml` | les `.js`, les tests, `package.json` | Erreurs probables dans le code, et les tests |

### Les lancer chez vous

Une seule fois, pour installer les outils :

```bash
npm install
```

Ensuite, quand vous voulez :

```bash
npm run lint       # relit le code et signale les erreurs probables
npm test           # lance les tests
npm run verifier   # les deux d'affilée
```

`node_modules/` est ignoré par Git : ces outils ne partent jamais en ligne.

### Ce que le linter vérifie — et ce qu'il ne vérifie pas

`eslint.config.mjs` n'active **que des règles de correction** : variable déclarée deux fois, code inaccessible, `=` écrit à la place de `==`, comparaison avec `NaN`…

Il n'y a **aucune règle de style** (indentation, guillemets, points-virgules), volontairement : elles produiraient un écart de plusieurs milliers de lignes sur le code existant, sans rien apporter. **N'en ajoutez pas.**

Le fichier déclare aussi la liste des fonctions partagées entre fichiers. **Si vous ajoutez une fonction dans `utils.js` et l'appelez depuis `index.js`, ajoutez son nom dans `globauxDuProjet`** — sinon le linter la signalera comme inconnue.

### Avertissements connus (7)

`npm run lint` affiche 7 avertissements `require-atomic-updates`, qui ne font pas échouer le contrôle. Ils signalent une variable modifiée après une attente réseau :

- `admin.js` : `_dashCacheTs`, `_dashRendering`, `contribId`, `parsedFilms`, `commentsAdminLoaded`
- `index.js` : `_thParsedFilms`, `mtCourantSelectedCineaste`

Ils n'ont pas été examinés un par un. Les cas équivalents dans `submit.js` l'ont été, et corrigés (voir « conditions de course » plus bas).

### Les tests

`_tests/utils.test.js` couvre les fonctions les plus fragiles de `utils.js` : celles qui lisent du texte saisi par des humains, dans des formats imprévisibles.

- l'analyseur de listes (`parseTopsBrut`) : séparateurs, années, lignes non reconnues, bornes de dates ;
- la résolution des noms et des portraits ;
- la distinction entre panne réseau (à rejouer) et refus de droits (à ne jamais rejouer) ;
- la neutralisation du HTML dans les présentations.

**Prenez l'habitude** : chaque fois qu'un contributeur vous signale une liste mal analysée, ajoutez-en un cas dans ce fichier. La suite se construira toute seule, à partir de vrais problèmes.

`_tests/_charger.js` charge un fichier du site dans un bac à sable, avec juste assez de faux navigateur pour qu'il s'exécute. **Aucun changement n'est demandé au code du site.**

> **Pas encore couverts** : `parseFilmStr` et `tcResoudreCineaste` vivent dans `index.js`, qui exécute beaucoup de code de navigateur au chargement et ne peut pas être chargé tel quel dans un test. Les déplacer dans `utils.js` les rendrait testables — c'est une bonne idée pour plus tard.

---

## Les identifiants Supabase

Ils sont dans `config.js`, en clair, et **c'est normal** : la clé `anon` est publique par conception. Ce qui protège les données, ce sont les règles d'accès (RLS) définies côté Supabase, pas le secret de cette clé.

Le contrôle des droits d'administration se fait à **deux** endroits, et le second seul compte vraiment :

1. côté site, `admin.js:159` (`if(!res.data.is_admin)`) — pour l'affichage ;
2. côté Supabase, dans les règles RLS — **c'est la vraie barrière**.

---

## Ce qu'il ne faut pas toucher

| Élément | Pourquoi |
|---|---|
| `alt=""` sur les portraits | C'est correct : le nom du cinéaste est juste à côté en texte. Un texte alternatif le ferait lire deux fois par un lecteur d'écran. |
| `shared.js` chargé **sans** `defer` | Volontaire : il applique le mode sombre avant le premier affichage, pour éviter un éclair blanc. |
| Les tris `localeCompare(…, 'fr')` | L'index est un index de noms propres : changer l'ordre alphabétique avec la langue désorienterait plus qu'autre chose. |
| Les dates de `admin.js` en `fr-FR` | Le back-office est en français et le restera : les deux administrateurs sont francophones. |
| `font-weight: normal` sur `.logo` et `.list-letter` | Ces éléments sont des `<h1>` et `<h2>`, gras par défaut. Sans ces deux lignes, la police d'affichage serait faussement graissée. |
| Les règles de style dans le linter | Voir plus haut. |

---

## Quelques choix de conception

**Conditions de course dans les enregistrements.** Les six formulaires de `submit.js` figent l'identifiant du contributeur *avant* l'attente réseau et vérifient qu'il y a toujours un profil en mémoire *après*. Sans ça, une déconnexion pendant un enregistrement — particulièrement pendant l'envoi d'un avatar, qui peut durer 40 s — provoquait une erreur.

**Panne ≠ résultat vide.** `supabase-js` ne rejette jamais ses promesses : une requête en échec résout normalement, avec `{ data: null, error }`. Un code qui ne lit que `data` confond donc « le serveur est en panne » et « il n'y a rien à afficher ». `tcSbError` (dans `utils.js`) transforme l'erreur en exception, pour qu'elle ne puisse pas être ignorée.

**Ajout non rejoué, modification rejouée.** Dans `submit.js` et « mes tops », un `INSERT` n'est jamais relancé automatiquement (il créerait un doublon si la réponse s'est perdue), alors qu'un `UPDATE`, idempotent, l'est.

**Requêtes en parallèle.** Supabase plafonne chaque réponse à 1 000 lignes. Les ~12 000 tops et ~3 300 cinéastes demandent donc plusieurs requêtes : elles sont lancées **toutes en même temps** après un comptage préalable, au lieu de s'attendre. Si le comptage échoue, le code retombe sur l'ancien enchaînement, plus lent mais correct.

---

## Audit

Un audit technique a été mené en septembre 2026. Les commentaires du code renvoient à ses numéros de constat (`B-01`, `B-29`…) et d'action (`A-002`, `A-057`…).
