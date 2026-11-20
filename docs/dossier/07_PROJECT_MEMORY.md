# 07 — Mémoire du projet

**Version du 17 novembre 2026.**

## 1. À ne jamais oublier

1. **Les documents du client font foi** : cahier d'extension, puis message du Dr, puis dossier institutionnel, puis ses réponses écrites, puis nos choix (`04` §1 ; `docs/sources-client.md` du dépôt). Une réponse écrite qui contredit le cahier se signale au Dr, elle ne se tranche pas en silence. Avant de poser une question au Dr, **chercher la réponse dans ses textes**.
2. **DiasPayQR ne détient jamais de fonds.** Paiement et séquestre sont exécutés par un partenaire habilité.
3. **Le TrustLink (DiasPay Link) ne sort jamais de l'application.** Les messages externes sont des textes fixes, sans lien, nom ni montant.
4. **Chaque demande et chaque échéance a son propre TrustToken**, quel que soit le mode de règlement. Supprimer le *lien partageable* ou l'*image du QR* ne veut pas dire supprimer le *jeton*.
5. **Le payeur décide.** Le bureau ne valide pas chaque demande ; il traite enrôlement, fraude, médiation et revue de risque facultative.
6. **Paiement direct par défaut** ; séquestre seulement pour les modules conditionnels.
7. **Un paiement exécuté reste exécuté** ; un remboursement est une nouvelle opération liée, avec contrepassation.
8. **Un témoin déclare, il ne certifie pas** ; un score n'est jamais une preuve ; l'IA n'autorise jamais seule ; l'urgence ne supprime aucun contrôle.
9. **Ne jamais inventer un chiffre** (plafonds, taux, frais, durées, seuils) : réglage configurable et `docs/open-parameters.md`.
10. **Ne jamais modifier une migration appliquée** ; jamais `service_role` dans un client ; aucune fonction ni table exécutable ou lisible par `anon`.
11. **Données de santé minimales** tant que l'atelier juridique n'a pas eu lieu.
12. **Aucun test sur téléphone** n'a été fait : ne rien présenter comme validé sur appareil.
13. **Le mode démonstration ne part jamais en boutique** ; `mock_mode` vaut `true` par défaut en base.
14. **Le design est validé avant le code.**
15. **Il n'y a pas eu de kickoff.** K1 à K14 sont nos propositions, auxquelles le Dr a répondu par écrit. K8 et K11 réduisent sa phase 1 : toujours les présenter comme telles.

## 2. Contexte historique utile

- Le projet est parti d'un résumé et du dossier institutionnel. J'en ai d'abord déduit un flux « paiement verrouillé puis débloqué » et une validation systématique par un bureau. Le cahier d'extension du Dr a corrigé cela après cinq lots livrés. Le dossier institutionnel avait été fourni dès le premier message et lu tardivement : l'écart est de ma responsabilité.
- Le Dr a proposé une réunion de kickoff ; elle n'a pas pu avoir lieu (indisponibilité). Les questions K1 à K14 lui ont été soumises par écrit et il y a répondu par écrit. **Le dossier du 13 novembre parlait à tort de « décisions du kickoff ».**
- Le Dr écrit comme si le développement n'avait pas commencé : toujours lui présenter l'existant avant toute discussion de périmètre.
- Le Dr attend les **14 livrables** de la section 7 de son cahier « à la suite de la réunion de cadrage ». Sans réunion, ces livrables sont le moyen de valider la vision par écrit. Le report de la documentation décidé en interne allait contre sa demande.
- **PAYQR** (présentiel, marchand vérifié, QR dynamique) et **DiasPayQR** (paiement documenté à distance) sont deux briques distinctes de l'écosystème ; DiasPay est l'interface de l'utilisateur.

## 3. Relations entre les fonctionnalités

- **Opération → demandes de paiement → contributions → tentatives → événements du partenaire → journal financier** ; une demande est `PAID` quand les contributions confirmées atteignent le montant cible.
- **Demande soumise → TrustToken → DiasPay Link (dans l'application) → espace de vérification du payeur → quatre actions**.
- **Litige** : avant paiement, `on_hold` + opération `SUSPENDED` ; après paiement, statut financier inchangé, éventuel remboursement lié avec contrepassation.
- **Enrôlement N0–N3 → plafonds → `accept_and_pay`** ; N1 pour initier, N2 pour un commerçant ; plafonds absents → refus.
- **Module (`request_modules`)** → pièces requises, mode de règlement, revue plateforme, mode du bénéficiaire, conservation ; un nouveau module est **une ligne de données**.
- **`platform_review`** (`NEVER` par défaut) ↔ file du back-office (`PENDING_REVIEW`).
- **Jeton** (révocable, lié à la demande) ↔ consultations journalisées ↔ journal d'audit chaîné ↔ reçu.
- **Numéro de téléphone** du profil ↔ invitations ↔ prise en charge du jeton de présentation : la sécurité de la liaison dépend de l'impossibilité de modifier ce numéro.
- **Simulateur et Supabase** implémentent la même interface ; la suite de contrat reste commune ; tout écart est listé dans `docs/supabase-setup.md` §9.

## 4. Erreurs passées et pièges

| Piège | Cause et correction |
|---|---|
| **Poser au client des questions auxquelles ses documents répondent** | Le 16 novembre, j'ai proposé une fiche de cinq questions au Dr ; le cahier y répondait déjà. Toujours relire les documents du client avant de solliciter le client |
| **Attribuer au client une décision qui est la nôtre** | « Décisions du kickoff » alors qu'il n'y a pas eu de kickoff. Toujours indiquer la source (`04` §1) |
| **Un prompt mal formulé fait perdre une exigence** | « Pas de lien partageable ni de QR » a conduit l'assistant à supprimer le TrustToken en direct (0014, 0018). Écrire explicitement ce qu'il faut **conserver** |
| **Relire un compte rendu sans le confronter au cahier du client** | L'écart du TrustToken n'a été vu que le 16 novembre |
| **Un complément de prompt perdu** | Deux compléments envoyés pendant T7 ne sont jamais parvenus à l'assistant. Coller chaque complément dans la session de Claude Code dès qu'il est rédigé, et vérifier dans le compte rendu suivant qu'il a été traité |
| **Annoncer un travail entre deux messages** | J'ai écrit deux fois « j'avance pendant ce temps » : je ne travaille que lorsque je réponds |
| **Ne pas transmettre un document de référence à l'assistant** | `ALIGNEMENT-CAHIER-EXTENSION.md` n'a jamais été copié dans `docs/` ; l'assistant a travaillé sans les questions K |
| **Politiques RLS sans restriction de colonnes** | `tx_update_draft` et `profiles_self_update` laissaient modifier toute colonne : passer par des fonctions, ou `grant update (colonnes)` |
| **Contrôle de droits à liste fermée** | Le test de `00_smoke` ne voyait pas une fonction nouvelle sans révocation : contrôle générique |
| **Client qui appelle une fonction de démonstration** | `SupabaseApi` appelait `demo_settle_payment` : le paiement réel échouait hors `mock_mode` |
| Migrations SQL jamais exécutées avant le lot 4 | pgcrypto inaccessible depuis `SECURITY DEFINER` (→ `sha256()`, `gen_random_uuid()`), politiques manquantes, transitions manquantes |
| L'éditeur SQL de Supabase découpe les scripts | Variante « éditeur » : un seul bloc `DO`, erreur volontaire finale |
| **La RLS filtre en silence** | Tester la valeur ou le nombre de lignes, pas une exception |
| `ALTER TYPE … ADD VALUE` | Valeur inutilisable dans la même transaction : fichier de migration séparé |
| Supabase accorde `EXECUTE` à `anon` par défaut | Retrait explicite et `alter default privileges` |
| Comptes créés par SQL | Colonnes de jetons à `''`, pas NULL |
| Numéros de téléphone | Stockés sans « + » ; comparer sur les chiffres normalisés ; unicité sur la forme normalisée |
| Temps réel dans le navigateur | Poser le jeton avant de rejoindre le canal |
| Pooler Supabase | Une session de test interrompue reste ouverte |
| Publication du canevas de design | Une sauvegarde faite sur la page invalide la publication : relire, fusionner, republier |
| Rendu de maquettes | Chromium (`@sparticuz/chromium` + `puppeteer-core`) plutôt que WeasyPrint |
| Mon bac à sable | Les services lancés s'arrêtent entre deux appels |
| Dates seules | Décalage d'un jour selon le fuseau |
| « Purpose Locked Money » | Affectation à un objet documenté, pas blocage généralisé |
| Archive dans le dépôt | `Archive.zip` (261 Mo, deux `.env.local`) non ignorée : `*.zip` dans `.gitignore` |

## 5. Outils et accès

- **Ce projet** : bac à sable avec bash, Python, `pdftotext` ; npm et pip via les domaines autorisés ; PostgreSQL non installé à ce jour (installable par apt pour émuler Supabase si besoin) ; artefacts (Claude Docs, canevas de design) ; mémoire du projet active, mais **les fichiers de connaissance restent la référence**.
- **Aucun accès** au dépôt, à Supabase, à Vercel : tout passe par les comptes rendus et les fichiers que Jean-Baptiste verse en connaissance.

## 6. Où se trouvent les livrables (16 novembre)

- **Documents du client** : cahier d'extension (PDF), dossier institutionnel (Markdown) en connaissance ; **message du Dr et réponses écrites à K1–K14 : à verser en connaissance**. Dans le dépôt : `docs/client/` (à remplir) et `docs/sources-client.md` (hiérarchie).
- **État du dépôt** : `ETAT-DES-LIEUX.md`, `RESUME-POUR-CLAUDE.md` et annexes, en connaissance et dans `docs/etat-des-lieux/` du dépôt.
- **Prompts** : `LOT-1` à `LOT-5`, `LOT-3BIS`, `LOT-X` (remplacé), `LOT-X-PROMPT-v2` (passe 3 à réviser), `LOT-XC-PROMPT` (terminé, fusionné le 17 novembre).
- **Spécifications** : `SPEC-MODELE-CIBLE-v2.md` (= `docs/specs/modele-cible-v2.md`), `ALIGNEMENT-CAHIER-EXTENSION.md` (à remplacer par le livrable 1).
- **Cahier des charges v1.0** : Claude Doc privé, **périmé** sur le flux, les statuts et les liens ; à exporter pour archive.
- **Maquettes** : canevas privé (33 écrans, v5) ; exports PDF et PNG ; périmées pour le parcours du payeur, les frais, le commerçant.
- **SQL historique** : `supabase-pack.zip` (0001–0004) **obsolète**.
