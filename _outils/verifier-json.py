#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TOPS / CINEASTES - controle des fichiers muzard.json et cnudde.json.

Deux niveaux, et la distinction est importante :

  ERREUR          casse le site pour vos visiteurs. Le controle echoue.
  AVERTISSEMENT   defaut de donnees, sans consequence pour l'affichage.
                  Signale, mais le controle reste au vert.

Cette separation est volontaire : un controle qui serait rouge en
permanence a cause de defauts connus (les rangs en double du point A-13,
les annees heterogenes du point A-14) finirait par etre ignore, et ne
servirait donc plus a rien.

Usage :
    python3 _outils/verifier-json.py
    python3 _outils/verifier-json.py --avant dossier/   (compare a l'etat precedent)
"""

import argparse
import json
import os
import sys
from collections import Counter

CONTRIBUTEUR_ATTENDU = {
    "muzard.json": "MATHIEU MUZARD",
    "cnudde.json": "KARINE CNUDDE",
}

# Une chute brutale du nombre de tops signale presque toujours un fichier
# tronque a la copie, plutot qu'une suppression volontaire.
SEUIL_CHUTE = 0.20


class Rapport:
    def __init__(self, fichier):
        self.fichier = fichier
        self.erreurs = []
        self.avertissements = []

    def erreur(self, message):
        self.erreurs.append(message)

    def avertir(self, message):
        self.avertissements.append(message)


def _texte_non_vide(valeur):
    return isinstance(valeur, str) and valeur.strip() != ""


def verifier_structure(donnees, rapport):
    """Ce qui casse l'affichage si c'est faux."""
    nom = os.path.basename(rapport.fichier)

    if not isinstance(donnees, dict):
        rapport.erreur("la racine du fichier devrait etre un objet { ... }, "
                       "et c'est %s" % type(donnees).__name__)
        return False

    for cle in ("contributeur", "version"):
        if not _texte_non_vide(donnees.get(cle)):
            rapport.erreur('le champ "%s" est absent ou vide' % cle)

    attendu = CONTRIBUTEUR_ATTENDU.get(nom)
    if attendu and donnees.get("contributeur") != attendu:
        rapport.erreur('le champ "contributeur" vaut %r, alors que %s doit '
                       'contenir %r' % (donnees.get("contributeur"), nom, attendu))

    tops = donnees.get("tops")
    if not isinstance(tops, list):
        rapport.erreur('le champ "tops" est absent, ou n\'est pas une liste')
        return False
    if not tops:
        rapport.erreur('le champ "tops" est une liste vide : le site '
                       "n'afficherait plus aucun top de ce contributeur")
        return False

    for i, top in enumerate(tops):
        ou = "tops[%d]" % i
        if not isinstance(top, dict):
            rapport.erreur("%s n'est pas un objet" % ou)
            continue
        if not _texte_non_vide(top.get("cineaste")):
            rapport.erreur('%s : "cineaste" absent ou vide' % ou)
            continue
        ou = "%s (%s)" % (ou, top["cineaste"])
        films = top.get("films")
        if not isinstance(films, list):
            rapport.erreur('%s : "films" absent ou n\'est pas une liste' % ou)
            continue
        if not films:
            rapport.erreur('%s : aucun film' % ou)
            continue
        for j, film in enumerate(films):
            ou_f = "%s, film %d" % (ou, j + 1)
            if not isinstance(film, dict):
                rapport.erreur("%s : n'est pas un objet" % ou_f)
                continue
            if not _texte_non_vide(film.get("titre")):
                rapport.erreur('%s : "titre" absent ou vide' % ou_f)
            rang = film.get("rang")
            if not isinstance(rang, int) or isinstance(rang, bool) or rang < 1:
                rapport.erreur('%s : "rang" vaut %r, un entier >= 1 est attendu'
                               % (ou_f, rang))
            if "note" in film and not isinstance(film["note"], str):
                rapport.erreur('%s : "note" devrait etre du texte, et vaut %s'
                               % (ou_f, type(film["note"]).__name__))

    return not rapport.erreurs


def verifier_qualite(donnees, rapport):
    """Defauts de donnees : signales, mais sans faire echouer le controle."""
    tops = donnees.get("tops") or []

    doublons = [nom for nom, n in Counter(
        t.get("cineaste") for t in tops
        if isinstance(t, dict) and _texte_non_vide(t.get("cineaste"))
    ).items() if n > 1]
    if doublons:
        rapport.avertir("%d cineaste(s) apparaissent plusieurs fois : %s"
                        % (len(doublons), ", ".join(sorted(doublons)[:5])
                           + (" ..." if len(doublons) > 5 else "")))

    rangs_doubles = 0
    annees_texte = 0
    annees_absentes = 0
    for top in tops:
        if not isinstance(top, dict):
            continue
        films = top.get("films")
        if not isinstance(films, list):
            continue
        rangs = [f.get("rang") for f in films if isinstance(f, dict)]
        if len(rangs) != len(set(rangs)):
            rangs_doubles += 1
        for film in films:
            if not isinstance(film, dict):
                continue
            if "annee" not in film:
                annees_absentes += 1
            elif isinstance(film.get("annee"), str):
                annees_texte += 1

    if rangs_doubles:
        rapport.avertir("%d cineaste(s) ont au moins deux films au meme rang "
                        "(point A-13 de l'audit)" % rangs_doubles)
    if annees_texte:
        rapport.avertir("%d film(s) ont une annee en texte plutot qu'en nombre "
                        "(point A-14)" % annees_texte)
    if annees_absentes:
        rapport.avertir("%d film(s) n'ont pas d'annee du tout (point A-14)"
                        % annees_absentes)


def verifier_evolution(donnees, avant, rapport):
    """Compare au fichier tel qu'il etait avant la modification."""
    if avant is None:
        return

    if donnees.get("tops") and avant.get("tops"):
        n_avant, n_apres = len(avant["tops"]), len(donnees["tops"])
        if n_apres < n_avant * (1 - SEUIL_CHUTE):
            rapport.erreur(
                "le nombre de tops chute de %d a %d (-%.0f %%). Si cette "
                "suppression est voulue, relancez ce controle apres avoir "
                "publie : il s'agit sinon d'un fichier tronque a la copie."
                % (n_avant, n_apres, 100.0 * (n_avant - n_apres) / n_avant))

    contenu_change = (donnees.get("tops") != avant.get("tops")
                      or donnees.get("contributeur") != avant.get("contributeur"))
    if contenu_change and donnees.get("version") == avant.get("version"):
        rapport.avertir(
            'le contenu a change mais "version" vaut toujours %r. Le fil '
            "Actualites n'annoncera donc pas cette mise a jour."
            % donnees.get("version"))


def controler(chemin, dossier_avant):
    rapport = Rapport(chemin)

    try:
        with open(chemin, "r", encoding="utf-8") as f:
            donnees = json.load(f)
    except FileNotFoundError:
        rapport.erreur("fichier introuvable")
        return rapport
    except UnicodeDecodeError as e:
        rapport.erreur("le fichier n'est pas encode en UTF-8 : %s" % e)
        return rapport
    except json.JSONDecodeError as e:
        rapport.erreur("ce n'est pas du JSON valide : %s (ligne %d, colonne %d)"
                       % (e.msg, e.lineno, e.colno))
        return rapport

    if verifier_structure(donnees, rapport):
        verifier_qualite(donnees, rapport)

    avant = None
    if dossier_avant:
        chemin_avant = os.path.join(dossier_avant, os.path.basename(chemin))
        if os.path.exists(chemin_avant):
            try:
                with open(chemin_avant, "r", encoding="utf-8") as f:
                    avant = json.load(f)
            except Exception:
                avant = None
    verifier_evolution(donnees, avant, rapport)

    return rapport


def main():
    parseur = argparse.ArgumentParser(add_help=True)
    parseur.add_argument("fichiers", nargs="*",
                         default=["muzard.json", "cnudde.json"])
    parseur.add_argument("--avant", default=None,
                         help="dossier contenant les fichiers avant modification")
    args = parseur.parse_args()

    fichiers = args.fichiers or ["muzard.json", "cnudde.json"]
    total_erreurs = 0

    for chemin in fichiers:
        rapport = controler(chemin, args.avant)
        total_erreurs += len(rapport.erreurs)

        print("")
        print("=" * 72)
        print("  %s" % chemin)
        print("=" * 72)

        for message in rapport.erreurs[:40]:
            print("  ERREUR          %s" % message)
        if len(rapport.erreurs) > 40:
            print("  ERREUR          ... et %d autres."
                  % (len(rapport.erreurs) - 40))
        for message in rapport.avertissements:
            print("  AVERTISSEMENT   %s" % message)

        if not rapport.erreurs:
            print("  OK  le fichier est utilisable par le site."
                  + ("" if not rapport.avertissements
                     else "  (%d avertissement(s) ci-dessus)"
                          % len(rapport.avertissements)))

    print("")
    if total_erreurs:
        print("ECHEC : %d erreur(s). Ne publiez pas ces fichiers en l'etat."
              % total_erreurs)
        return 1
    print("Controle reussi : les fichiers peuvent etre publies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
