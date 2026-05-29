# tops-cineastes

Application web communautaire pour cinéphiles permettant de consulter des fiches de cinéastes, poster des tops de leurs films, et générer des statistiques croisées entre membres.

---

## Contexte du projet

Depuis 2020, une communauté de cinéphiles poste des "tops cinéastes" sur Facebook — c'est-à-dire le classement des films d'un cinéaste donné, du préféré au moins apprécié. Environ 15 000 tops ont été accumulés sur ~2900 cinéastes.

Le projet vise à migrer et enrichir cette activité sur un site dédié, en liant chaque film à une fiche TMDB pour permettre des statistiques et comparaisons poussées entre membres.

---

## Données de départ

| Source | Contenu | Format |
|--------|---------|--------|
| `index_des_cineastes.docx` | ~2900 cinéastes avec lien Facebook vers chaque fiche | Word (.docx) |
| `tableau_de_statistiques.xlsx` | Matrice cinéastes × membres (1 = top posté) | Excel (.xlsx) |
| `contributeurs.docx` | Profils détaillés de certains membres (cinéastes ❤, films ❤, déclaration cinéphile) | Word (.docx) |
| Export Facebook (à faire) | ~15 000 tops en texte libre dans les commentaires | JSON Facebook |

### Structure d'une fiche cinéaste (Facebook)
- Prénom et nom du cinéaste
- Date de naissance et de décès (entre parenthèses)

### Structure du tableau de statistiques (Excel)
- Ligne = cinéaste (nom en majuscules, alphabétique)
- Colonne = membre
- Valeur = `1` si le top a été posté, vide sinon, `en cours` si en cours

### Structure des profils membres (contributeurs.docx)
Pour chaque membre documenté :
- **3 cinéastes ❤** (cinéastes du cœur, mis en avant)
- **Liste complète des cinéastes favoris**
- **Films préférés** avec ❤ pour les favoris absolus
- **Déclaration cinéphile** (philosophie personnelle du cinéma) — présente pour certains membres

---

## Stack technique

| Besoin | Solution | Coût |
|--------|----------|------|
| Hébergement frontend + données | GitHub Pages + fichiers JSON | Gratuit |
| API films | TMDB (The Movie Database) | Gratuit |
| Framework frontend | HTML / CSS / JavaScript vanilla | Gratuit |
| Authentification | À définir (solution légère) | Gratuit |

### Choix d'architecture : fichiers JSON
Les données sont stockées dans des fichiers JSON versionnés dans le repo GitHub, sans base de données externe.

```
tops-cineastes/
├── cineastes.json
├── membres.json
├── tops.json
├── tops_stats.json
├── index.html
├── top-editor.html
└── README.md
```

---

## Structure des données JSON

### cineastes.json
```json
{
  "id": 1,
  "nom": "ALDRICH",
  "prenom": "Robert",
  "annee_naissance": 1918,
  "annee_deces": 1983,
  "lien_facebook": "https://www.facebook.com/photo?fbid=...",
  "fbid": "123456789"
}
```

### membres.json
```json
{
  "id": 1,
  "prenom": "Prénom",
  "nom": "Nom",
  "annee_naissance": 1990,
  "cineastes_coeur": ["BRESSON Robert", "MIZOGUCHI Kenji", "OZU Yasujiro"],
  "cineastes_favoris": ["GODARD Jean-Luc", "TARKOVSKY Andrei"],
  "films_coeur": [
    { "titre": "Au hasard Balthazar", "cineaste": "BRESSON", "annee": 1966 }
  ],
  "declaration": "Texte libre de philosophie cinéphile...",
  "email": "",
  "actif": true
}
```

### tops_stats.json
```json
{
  "par_cineaste": {
    "42": { "posted": [1, 3, 5], "en_cours": [2], "total": 3 }
  },
  "par_membre": {
    "1": 1499
  }
}
```

### tops.json
```json
{
  "id": 1,
  "membre_id": 1,
  "cineaste_id": 42,
  "date": "2024-03-15",
  "source": "site",
  "films": [
    { "position": 1, "tmdb_id": 11234, "titre": "Au hasard Balthazar", "annee": 1966 },
    { "position": 2, "tmdb_id": 11235, "titre": "Mouchette", "annee": 1967 }
  ]
}
```

---

## Les 4 phases du projet

### Phase 1 — Données et import ✅ Terminé
- `cineastes.json` généré depuis `index_des_cineastes.docx` (2905 entrées)
- `membres.json` généré depuis `tableau_de_statistiques.xlsx` + `contributeurs.docx` (23 membres)
- `tops_stats.json` généré depuis la matrice Excel (14 051 tops)

### Phase 2 — Le site ✅ Terminé
- Page d'accueil avec recherche et navigation alphabétique
- Fiche de chaque cinéaste (tops postés, statistiques, membres)
- Page membres avec cartes et profils complets
- Design sobre et élégant (fond mixte, bordeaux, typographie DM Serif/Sans)

### Phase 3 — Création de tops ✅ En cours
- `top-editor.html` : interface de création avec recherche TMDB, drag & drop, ajout manuel
- ⬜ Brancher la vraie clé API TMDB (en attente de validation du compte)
- ⬜ Système de sauvegarde des tops

### Phase 4 — Migration des anciens tops ⬜ À faire
- Export des données Facebook (commentaires de l'album)
- Normalisation des tops texte libre → liste structurée via IA
- Matching de chaque film avec TMDB
- Import dans `tops.json` sous `source: "facebook"`
- Les membres retrouvent leurs anciens tops à leur première connexion

### Phase 5 — Authentification ⬜ À faire
- Système d'invitation par email
- Comptes pré-créés (profil et anciens tops déjà présents à la connexion)
- Rôles : admin / membre connecté / visiteur

---

## Rôles utilisateurs

| Rôle | Capacités |
|------|-----------|
| Admin (propriétaire) | Tout : import, création de comptes, modération, statistiques globales |
| Membre connecté | Poster et modifier ses tops, enrichir son profil, consulter les tops des autres |
| Visiteur (non connecté) | Consulter les fiches cinéastes, les tops et les profils membres (lecture seule) |

---

## Statistiques prévues

- **Par cinéaste** : nombre de tops postés, film classé #1 le plus souvent, participation des membres
- **Par membre** : nombre de tops postés, cinéastes les plus topés, films les plus récurrents
- **Communauté** : cinéastes les plus topés, films les plus cités comme favoris absolus, affinités entre membres

---

## Design

Inspiré de RateYourMusic et Letterboxd : sobre, élégant, fond mixte (sombre/crème), couleur bordeaux, typographie DM Serif Display + DM Sans.

---

## Instructions pour reprendre le projet en nouvelle session Claude

1. Partager ce fichier README en début de conversation
2. Préciser la phase sur laquelle on travaille
3. Partager les fichiers de données si nécessaire :
   - `index_des_cineastes.docx`
   - `tableau_de_statistiques.xlsx`
   - `contributeurs.docx`
4. Préciser l'état d'avancement (ce qui a déjà été fait)

---

## Statut global

> 🟡 **En cours de développement** — Phases 1, 2 et 3 (partielle) terminées. En attente de clé API TMDB pour finaliser la Phase 3.

---

*Dernière mise à jour : mai 2026*
