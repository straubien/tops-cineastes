# tops-cineastes

Application web communautaire pour cinéphiles permettant de consulter des fiches de cinéastes, poster des tops de leurs films, et générer des statistiques croisées entre membres.

---

## Contexte du projet

Depuis 2020, une communauté de cinéphiles (25 membres actifs) poste des "tops cinéastes" sur Facebook — c'est-à-dire le classement des films d'un cinéaste donné, du préféré au moins apprécié. Environ 15 000 tops ont été accumulés sur ~2900 cinéastes.

Le projet vise à migrer et enrichir cette activité sur un site dédié, en liant chaque film à une fiche TMDB pour permettre des statistiques et comparaisons poussées entre membres.

---

## Données de départ

| Source | Contenu | Format |
|--------|---------|--------|
| `index_des_cineastes.docx` | 2900 cinéastes avec lien Facebook vers chaque fiche | Word (.docx) |
| `tableau_de_statistiques.xlsx` | Matrice cinéastes × membres (25 membres, 1 = top posté) | Excel (.xlsx) |
| `contributeurs.docx` | Profils détaillés de ~12 membres (cinéastes ❤, films ❤, déclaration cinéphile) | Word (.docx) |
| Export Facebook (à faire) | ~15 000 tops en texte libre dans les commentaires | JSON Facebook |

### Structure d'une fiche cinéaste (Facebook)
- Prénom et nom du cinéaste
- Date de naissance et de décès (entre parenthèses)

### Structure du tableau de statistiques (Excel)
- Ligne = cinéaste (nom en majuscules, alphabétique)
- Colonne = membre (prénom + nom + année de naissance)
- Valeur = `1` si le top a été posté, vide sinon, `en cours` si en cours

### Structure des profils membres (contributeurs.docx)
Pour chaque membre documenté :
- **3 cinéastes ❤** (cinéastes du cœur, mis en avant)
- **Liste complète des cinéastes favoris** (30 à 50 par personne)
- **Films préférés** avec ❤ pour les favoris absolus (top 10 environ)
- **Déclaration cinéphile** (philosophie personnelle du cinéma) — présente pour certains membres

Membres documentés dans contributeurs.docx : Bastien Teklow, Clément Guiborel, Daniel Jirden, Franky Fockers, Frédéric Guez, Grégory Lescard, Julien D'Abrigeon, Keefe Murphy, Mathieu Muzard, Seb Lapin, Simone Roghi, Thierry Jousse, Thomas Demaerел, Thoracentèse Rubis, Vinz Orlov

### Liste des 25 membres actifs
KEEFE Murphy (1990), DANIEL Jirden (1986), MAT (1985), BASTIEN Teklow (1984), VINZ Orlov, SEB Lapin (1981), FRANKY Fockers (1971), THORACENTESE Rubis, GREGORY Lescard (1986), FREDERIC Guez (1975), THOMAS D. Demaerел (1981), KARINE Cnudde (1972), ARNAUD Bstop (1986), THIERRY Jousse (1961), SIMONE Roghi (1994), JULIEN D'Abrigeon (1973), ILAN Malka (1979), THOMAS F. Flavier (1985), CLEMENT Guiborel (1988), YANN Proust (1977), ANTOINE Mouton (1981), EDO Volbeda, LILIAN Fanara, WILLE Lindelow (1998), PATERN Rival (1984)

---

## Stack technique

| Besoin | Solution | Coût |
|--------|----------|------|
| Hébergement frontend + données | GitHub Pages + fichiers JSON | Gratuit |
| API films | TMDB (The Movie Database) | Gratuit |
| Framework frontend | HTML / CSS / JavaScript vanilla | Gratuit |
| Authentification | À définir (solution légère pour 25 membres) | Gratuit |

### Choix d'architecture : fichiers JSON
Les données sont stockées dans des fichiers JSON versionnés dans le repo GitHub, sans base de données externe. Adapté à la taille du projet (2900 cinéastes, 25 membres).

```
tops-cineastes/
├── data/
│   ├── cineastes.json
│   ├── membres.json
│   ├── tops.json
│   └── films_favoris.json
├── prototype.html
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
  "lien_facebook": "https://www.facebook.com/photo?fbid=..."
}
```

### membres.json
```json
{
  "id": 1,
  "prenom": "Keefe",
  "nom": "Murphy",
  "annee_naissance": 1990,
  "cineastes_coeur": ["BRESSON Robert", "MIZOGUCHI Kenji", "OZU Yasujiro"],
  "cineastes_favoris": ["GODARD Jean-Luc", "TARKOVSKY Andrei", "..."],
  "films_coeur": [
    { "titre": "PATHER PANCHALI", "cineaste": "RAY", "annee": 1955 },
    { "titre": "TOKYO STORY", "cineaste": "OZU", "annee": 1953 }
  ],
  "declaration": "Texte libre de philosophie cinéphile...",
  "email": "",
  "actif": true
}
```

### tops.json
```json
{
  "id": 1,
  "membre_id": 1,
  "cineaste_id": 42,
  "date_creation": "2024-03-15",
  "source": "facebook",
  "films": [
    { "position": 1, "tmdb_id": 11234, "titre": "Au hasard Balthazar", "annee": 1966 },
    { "position": 2, "tmdb_id": 11235, "titre": "Mouchette", "annee": 1967 }
  ]
}
```

---

## Les 4 phases du projet

### Phase 1 — Données et import ⬜ À faire
- Générer `cineastes.json` depuis `index_des_cineastes.docx` (2900 entrées)
- Générer `membres.json` depuis `tableau_de_statistiques.xlsx` + `contributeurs.docx`
- Vérifier et valider les données importées

### Phase 2 — Le site ⬜ À faire
- Page d'accueil avec recherche et navigation alphabétique de cinéastes
- Fiche de chaque cinéaste (tops postés par les membres, statistiques)
- Profil de chaque membre :
  - 3 cinéastes ❤ mis en avant
  - Déclaration cinéphile
  - Films ❤ absolus
  - Liste des tops postés
- Tableau de bord admin (équivalent du tableau Excel actuel)
- Système d'authentification par invitation

### Phase 3 — Les nouveaux tops ⬜ À faire
- Interface de création d'un top : recherche de films via TMDB, classement par drag & drop
- Membres peuvent enrichir leur profil (cinéastes favoris, films ❤, déclaration)
- Statistiques croisées : film le plus souvent classé #1, comparaison entre membres, etc.

### Phase 4 — Migration des anciens tops ⬜ À faire
- Export des données Facebook (commentaires de l'album)
- Normalisation des tops texte libre → liste structurée via IA
- Matching de chaque film avec TMDB
- Import dans `tops.json` sous `source: "facebook"`
- Les membres retrouvent leurs anciens tops dans leur profil dès leur première connexion

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
- **Communauté** : cinéastes les plus topés, films les plus cités comme favoris absolus, affinités entre membres (% de recoupement des cinéastes ❤)

---

## Design

Inspiré de RateYourMusic.com : sobre, dense, orienté données, fond sombre.
Un prototype HTML fonctionnel est disponible dans `prototype.html`.

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

> 🟡 **En cours de conception** — Phase 0 terminée (analyse, prototype design validé). Prêt à démarrer la Phase 1.

---

*Dernière mise à jour : mai 2026*
