# Conformité au design — maquette v5 (33 écrans)

- **Référence** : `docs/maquette/` (images fournies, 780 × 1688 pour le mobile).
- **Captures** : `docs/captures/`, produites par `pnpm capture` (`scripts/design-capture.mjs`) : export web de démonstration, Chrome piloté par playwright-core, 390 × 844 points, facteur 2.
- **Méthode** : comparaison côte à côte de chaque paire (hiérarchie et tailles de texte, couleurs issues des tokens, espacements, filets et absence de cartes, points de statut, boutons, zones tactiles, textes exacts, ordre des éléments).
- **Date** : 10 novembre 2026.

**Résumé** : 2 conformes · 24 écarts corrigés · 3 écarts acceptés · 4 hors périmètre mobile (back-office). Aucun écart non traité.

Un écran « écart corrigé » peut garder un écart secondaire accepté : il est indiqué dans la colonne « Constat » avec sa raison. Les montants, dates et références diffèrent de la maquette quand ils viennent du jeu de démonstration ou de l’horloge : ce ne sont pas des écarts.

## Corrections transversales

- **Police Inter** (400, 500, 600, 700) sur tous les textes, champs et libellés d’onglets.
- **Lignes libellé / valeur sans filet** entre elles (détail, paiement, reçu, litige, récapitulatif), filet sous l’en-tête là où la maquette en a un.
- **Dates courtes** : l’année est omise pour l’année en cours (« 15 nov. », « 15 janv. 2027 »).
- **Bouton destructif plein** (« Ouvrir le litige ») et **interrupteur** conforme (pilule verte, bouton blanc) sur toutes les plateformes.
- Libellé d’onglet « Transactions » non tronqué.

## Tableau

| # | Écran | État | Constat | Correction |
|---|---|---|---|---|
| 01 | A1 Lancement | conforme | Logo, nom, accroche, langues et mention alignés sur la maquette. | — |
| 02 | A2 Présentation 1 | écart corrigé | Illustration différente (QR dans un cadre de visée) ; contenu en haut au lieu d’être centré ; « Passer » en vert. | Illustration redessinée (cadre vert, trois cases jaunes, coche rouge), page centrée verticalement, « Passer » en gris atténué. |
| 03 | A2 Présentation 2 | écart corrigé | Cadenas en traits au lieu d’un cadenas plein. | Cadenas plein vert, serrure jaune ; centrage. |
| 04 | A2 Présentation 3 | écart corrigé | Document avec quatre lignes et coche décentrée. | Document à coin plié, deux lignes jaunes, coche rouge en bas à droite ; centrage. |
| 05 | A3 Connexion | écart corrigé | Bouton, langues et mention sous les champs au lieu du pied d’écran ; langue active soulignée en jaune. | Bouton, bascule de langue et mention en pied d’écran ; langue active en vert gras, soulignement jaune réservé au lancement. |
| 06 | A3 Code OTP | écart corrigé | Titre en grand dans le contenu ; numéro non formaté ; minuteur centré ; lien souligné. Écart accepté : rappel « Simulation : le code est 123456 » (builds de démonstration seulement). | Titre dans la barre, numéro « +33 6 12 34 56 78 », minuteur et lien alignés à gauche sans soulignement. |
| 07 | A4 Profil initial | écart corrigé | Pas de barre de retour ; grand avatar vert centré ; chevron dans le champ pays. Écart accepté : « Ajouter une photo » absent (photo de profil hors périmètre, décision du lot 1). | Barre avec retour et « Étape 1 sur 2 », avatar d’initiales 56 px sur fond neutre à gauche, champ pays sans chevron. |
| 08 | A5 Biométrie | écart corrigé | Titre dans le contenu ; icône dans un disque vert pâle ; contenu en haut. Écart accepté (plateforme) : le web n’a pas de biométrie, d’où le message « Aucune biométrie » et « Continuer » ; sur iPhone, « Activer Face ID » et « Utiliser un code à la place ». | Barre avec retour et « Étape 2 sur 2 », icône seule 72 px, contenu centré. |
| 09 | G1 Type de besoin | écart accepté | Agro, Immobilier et Terrain grisés « Bientôt disponible » (la maquette les montre actifs). Raison : exigence du lot 3, vague 1 (Scolarité, Santé, Loyer seulement). | — |
| 10 | G2 Détails | écart corrigé | Libellé « Date souhaitée (facultative) ». Écarts acceptés : sélecteur de date du navigateur sur le web (plateforme ; sélecteur natif sur téléphone) ; bouton « × » pour effacer la date facultative (sinon impossible à vider sur téléphone). | Libellé « Date souhaitée ». |
| 11 | G3 Prestataire | écart corrigé | Libellé visible au-dessus de la recherche, pas de loupe ; « + » en texte. | Champ de recherche à loupe sans libellé visible (libellé conservé pour les lecteurs d’écran), icône « + ». |
| 12 | G4 Plan de paiement | écart corrigé | Formulaire complet par tranche au lieu de lignes compactes ; compteur de tranches ; « Ajouter une tranche » dans le contenu. Écart accepté : texte d’aide sous le choix du plan (décision D3). | Lignes compactes (titre, date, montant) ; toucher une tranche ouvre sa fiche (libellé, échéance, montant, suppression) ; « Ajouter une tranche » en pied d’écran ; « Somme des tranches : 900 000 / 900 000 FCFA ». |
| 13 | G5 Justificatifs | écart corrigé | En-tête « Type » sans montant ni prestataire ; « pièce(s) obligatoire(s) ». Écart accepté : fichiers listés sous chaque pièce avec « n sur 3 » et bouton « Ajouter » maintenu (décision D2, jusqu’à 3 fichiers). | « Type de besoin », ligne « montant · prestataire », « Il manque 1 pièce obligatoire. ». |
| 14 | G6 Récapitulatif | écart corrigé | Filets entre les lignes ; « pièce(s) jointe(s) ». Écart accepté : bloc « Déblocage » (règle de déblocage en clair, exigence du lot 3). | Lignes sans filet, filet sous l’en-tête, accords (« 2 pièces jointes »). |
| 15 | B1 Accueil | écart corrigé | Rôle seul sous le nom ; la transaction « À faire » répétée dans « Mes transactions » ; statut sous le titre et chevron ; montant total au lieu de la tranche ; note « Données simulées ». | « France · Payeur » (pays de résidence : le profil ne contient pas de ville) ; transaction « À faire » non répétée ; statut à droite sans chevron ; « Tranche n sur N · montant de la tranche » ; note retirée. |
| 16 | C1 Transactions | écart corrigé | Filtres en contrôle segmenté ; titre « type · objectif » ; statut sous le titre et chevron. Écart accepté : « Agro · Semences (Brouillon) » absent ; les brouillons viennent de l’assistant et s’affichent en tête de liste (lot 3). | Filtres en pastilles (contour, active en vert, 44 px de zone tactile), titre « type · prestataire », « montant · tranche n sur N » ou « jalon n sur N », statut à droite sans chevron. |
| 17 | C2 Détail et tranches | écart corrigé | Sous-titre « 3 tranche(s) » ; lignes Statut et Montant total, titre « Tranches » ; tranches titrées par leur libellé ; année affichée. Écart accepté : « Afficher le QR » à côté de « Payer » (accès au jeton depuis la tranche, exigence du lot 2). | « 900 000 FCFA · 3 tranches », lignes sans filet, statut sous les lignes, « Tranche n · montant », « Confirmée par École Les Palmiers. Déblocage automatique le… », dates courtes. |
| 18 | H2 TrustToken et eQR | écart corrigé | **Défaut** : le DiasPay Link débordait de l’écran. QR de 276 px, référence sans « Réf. », titre « DiasPay Link » et ligne Statut en plus. Écarts acceptés : « Enregistrer le QR » absent sur le web (plateforme : capture d’image indisponible) ; QR plus dense (contenu eQR réel). | Lien sur une ligne abrégé au milieu, « DiasPay Link® » en libellé, QR 200 px, « Réf. 7B31-… », filets, titre et ligne Statut retirés. |
| 19 | H3 Paiement | écart corrigé | Titre sans numéro ; montant en vert ; titre « Moyen de paiement » ; moyens sans précision ; mention de verrouillage sans encadré. Écart accepté : « confirmation du prestataire » (texte générique pour toutes les verticales) au lieu de « de l’école ». | « Payer la tranche 2 », montant en encre, sous-titres (« Visa, Mastercard »…), encadré vert pâle avec cadenas. |
| 20 | H5 Scan prestataire | écart accepté | Plateforme : pas de caméra sur le web ; l’écran propose la saisie de la référence. La vue caméra et la feuille « QR valide » s’affichent sur téléphone (lot 2). | — |
| 21 | H8 Dépôt de preuve | écart accepté | Hors périmètre (dépôt de preuve de jalon, vague 2). Capture : détail du terrain, jalon « Preuve en cours de validation ». | — |
| 22 | H9 Ouvrir un litige | écart corrigé | Sous-titre « objectif · libellé » ; « Fin du délai de contestation » ; titre « Motif » ; filets ; bouton en contour « Ouvrir un litige » ; pas de « Joindre une pièce ». | « Scolarité · Tranche 1 », « Contestation possible jusqu’au », sans titre « Motif », lignes sans filet, bouton rouge plein « Ouvrir le litige », « Joindre une pièce » affiché désactivé (ajout de pièces à un litige hors périmètre). |
| 23 | H7 Reçu | écart corrigé | **Défaut** : les tranches débloquées du jeu de démonstration n’avaient pas de date de déblocage, le reçu était refusé. | Date de déblocage du jeu de démonstration ; reçu conforme (coche, montant, lignes, empreinte abrégée, « Journal d’audit vérifié », PDF et partage). |
| 24 | Back-office : dossiers | hors périmètre mobile | Application d’administration (lot 5). | — |
| 25 | E1 Alertes | écart corrigé | « Échéance le 15 nov.. » (double point) ; titre plus petit. Écart accepté : « Preuve rejetée » n’existe pas parmi les événements de ce lot (preuves de jalon en vague 2). | Point final unique après une date abrégée ; titre 26 px. |
| 26 | E1 Alertes, état vide | écart corrigé | Cloche et titre plus petits. | Cloche 96 px, titre 20 px. |
| 27 | F1 Profil | conforme | Écarts acceptés : « La biométrie et code de secours » sur le web (pas de Face ID) ; « Bientôt disponible » à droite du centre d’aide et des conditions tant que `EXPO_PUBLIC_HELP_URL` et `EXPO_PUBLIC_TERMS_URL` sont vides ; outils de démonstration en bas (builds `EXPO_PUBLIC_DEMO=1` seulement). | — |
| 28 | F2 Sécurité | écart corrigé | Interrupteur natif du web (bouton vert d’eau) ; « remplace La biométrie » (majuscule). Écarts acceptés : « Définir » grisé « Bientôt disponible » (code de secours au lot 4) ; biométrie désactivée sur le web (plateforme). | Composant `Toggle` conforme sur toutes les plateformes ; minuscule dans la phrase. |
| 29 | H10 Litige en cours | écart corrigé | Actions de démonstration serrées dans le pied d’écran ; déroulement trop resserré. Écart accepté : « Ajouter une pièce » désactivé « Bientôt disponible » (hors périmètre). | Actions de démonstration dans le contenu (builds de démonstration seulement), espacement du déroulement. |
| 30 | H10 Litige résolu | écart corrigé | Déroulement trop resserré ; note de décision plus grande. « (Exemple) » de la maquette est un texte d’illustration. | Espacement et taille de la note. |
| 31 | Back-office : preuves | hors périmètre mobile | Lot 5. | — |
| 32 | Back-office : litiges | hors périmètre mobile | Lot 5. | — |
| 33 | Back-office : journal | hors périmètre mobile | Lot 5. | — |

## Reproduire

```
pnpm capture            # export web de démonstration puis captures
pnpm capture --no-build # captures sur l’export existant
```

Le script échoue (code de sortie 1) si un écran mobile de la maquette n’a pas sa capture.
