# Lot X version 2 : contrôles SQL modifiés, remplacés ou ajoutés

Annexe de `docs/decisions.md` (entrée X2-v2). Une ligne par contrôle : ancien libellé → nouveau → raison. Les comportements changent volontairement (modèle cible, `docs/specs/modele-cible-v2.md`) ; aucun contrôle n’a été supprimé sans remplaçant.

Comptes (projet de développement, avec 0013 à 0018) : 00_smoke 70 → 93, 01_lot4 119 → 130, 02_lot5 133 → 143, 03_lotx 111 → 115, 04_lotx_p2 123 → 139. Les défauts de 0014 relevés pendant ces mises à jour sont corrigés par 0017 (alerte de libération en double après un litige) et 0018 (réémission d’un jeton en règlement direct, code REQUEST_ON_HOLD masqué).


## supabase/tests/00_smoke.sql — mise à jour lot X v2 (0014, 0015, 0016)

Nombre de vérifications : 70 avant → 93 après. Résultat : `RESULTAT : 93 vérifications, toutes réussies`.

### Cadre (sans vérification)
- Ajout de l’assistant `t.hint` (identique à 01_lot4) pour vérifier les codes d’erreur.
- `update request_modules set platform_review = 'ALWAYS' where code in ('EDUCATION','HEALTH')` : la revue du bureau reste jouée sur scolarité et santé (NEVER par défaut).
- Échéances de la scolarité relatives à `current_date` (+3, +60, +150) : la première est soumise de façon déterministe à l’activation (7 jours de prévenance).
- Agro ouvert et configuré en `PROVIDER_CONFIRM` le temps du test : aucun module CONDITIONAL n’a ce mode par défaut, or le scan du prestataire n’existe plus qu’en CONDITIONAL + PROVIDER_CONFIRM.

### Vérifications modifiées, remplacées ou ajoutées
- aucune fonction sensible exécutable par anon → même libellé, liste élargie (submit_operation, claim_dossier, request_info, answer_info, reject_request, confirm_service, submit_evidence, approve_release, start_payment, request_refund, respond_dispute, lift_suspension, suspend_operation, expire_due_requests, accept_plan) → nouvelles fonctions sensibles du modèle v2.
- fonctions internes non exécutables par authenticated → même libellé, liste élargie (_set_tx_status, _set_funds_state, _submit_request, _activate_operation, _platform_review, _create_refund, _resolve_dispute_v2, _process_payment_event, expire_due_requests) → nouvelles fonctions internes.
- création de 3 tranches par le demandeur → inchangée (dates relatives).
- soumission acceptée avec plan et pièce → « … : en attente de revue (platform_review ALWAYS) », statut = PENDING_REVIEW → SUBMITTED n’existe plus ; avec revue, la soumission mène à PENDING_REVIEW.
- changement de statut direct sans effet pour le client (RLS) → même libellé, tentative `status='ACTIVE'` au lieu de VALIDATED → VALIDATED n’existe plus (refusé par contrainte).
- le statut est resté SUBMITTED → « le statut est resté PENDING_REVIEW » → nouveau statut.
- un seul validateur suffit pour la scolarité → « … : opération active », = ACTIVE → l’approbation mène à ACTIVE (VALIDATED supprimé).
- jeton émis (simulé) → « règlement direct : aucun jeton émis pour la demande soumise » → plus de statut TOKEN_ISSUED ; en DIRECT aucun jeton (jetons seulement en CONDITIONAL, vérifié sur l’agro).
- transaction en cours → « opération active : demandes 2 et 3 programmées (DRAFT) », statuts = {SUBMITTED,DRAFT,DRAFT} → IN_PROGRESS supprimé ; l’activation ne soumet que les demandes dues.
- tranche 1 activée → « tranche 1 activée : demande soumise à l’activation (échéance dans les 7 jours) », = SUBMITTED → AWAITING_PAYMENT → SUBMITTED, posée automatiquement par decide_tx.
- (ajout) alerte TX_VALIDATED aux trois parties après la décision du bureau → notification v2.
- (ajout) demande soumise : alerte PAYMENT_REQUEST_RECEIVED au payeur (non initiateur) → notification v2.
- tranche 1 payée et verrouillée → « tranche 1 payée : PAID directement, sans blocage des fonds (règlement direct) », = PAID/NONE → PAID_LOCKED supprimé ; en DIRECT, paiement → PAID, funds_state NONE.
- (ajout) alerte REQUEST_PAID au paiement → notification v2.
- tranche suspendue en litige → scindée : (1) « litige après paiement : demande toujours PAID (non suspendue), opération toujours ACTIVE » sur la scolarité ; (2) « tranche suspendue en litige (on_hold), opération SUSPENDED » sur l’agro, litige avant paiement → DISPUTED supprimé ; la suspension n’existe plus qu’avant paiement (K7).
- le prestataire ne peut pas trancher → même libellé, t.hint ADMIN_ONLY, issue REFUND_FULL, litige ciblé par tranche → issue v2 ; code précis (l’ancienne note « x » échouait aussi pour motif trop court).
- un validateur non administrateur ne peut pas trancher → idem, t.hint ADMIN_ONLY.
- l'administrateur rembourse le payeur → même libellé, = RESOLVED/REFUND_FULL → statut REFUNDED_TO_PAYER remplacé par RESOLVED + outcome.
- (ajout) remboursement intégral créé (en attente d’exécution), demande encore PAID → ligne `refunds` de 300000 PENDING.
- tranche annulée après remboursement → « tranche remboursée (REFUNDED) après exécution du remboursement », = REFUNDED/300000 (après demo_settle_refund) → PAID → REFUNDED (avec refunded_minor) au lieu de CANCELLED.
- paiement marqué remboursé → inchangé (après exécution du remboursement).
- (ajout) tranche 2 payée et versée sans confirmation (règlement direct) → PAID/NONE.
- (ajout) règlement direct : aucune confirmation de service [WRONG_MODE].
- (ajout) reçu disponible dès le paiement (règlement direct) → get_receipt.
- (ajout) événement de versement DIRECT_PAYMENT → release_events en DIRECT.
- (ajout) l’initiateur soumet plus tôt une demande programmée → transition_tranche DRAFT → SUBMITTED.
- le payeur annule une tranche en attente de paiement → remplacé par (1) « le payeur ne peut pas annuler une demande (réservé à l’initiateur) » [INITIATOR_ONLY] et (2) « l’initiateur annule une demande soumise non payée » = CANCELLED → transition_tranche réservée à l’initiateur.
- la transaction se clôt quand toutes les tranches sont terminées → inchangée (REFUNDED, PAID/NONE, CANCELLED ⇒ CLOSED).
- (ajout) platform_review NEVER : opération active dès la soumission (agro) → chemin par défaut v2.
- (ajout) événement AUTO_ACTIVATED au journal.
- (ajout) jalons : le premier soumis à l’activation, le suivant programmé.
- (ajout) règlement conditionnel : jeton émis à la soumission de la demande.
- (ajout, reprend l’ancienne « payée et verrouillée ») tranche payée et verrouillée (fonds HELD) → PAID/HELD en CONDITIONAL.
- référence du jeton : 18 caractères hexadécimaux → inchangée, déplacée sur l’agro (pas de jeton en DIRECT).
- le payeur ne peut pas confirmer par scan → inchangée, sur l’agro.
- heure d'appareil trop avancée refusée → inchangée, sur l’agro.
- le prestataire confirme par scan → « … (fonds encore bloqués) », = PAID/HELD/confirmed_at posé → CONFIRMED supprimé ; la confirmation pose confirmed_at.
- second scan du même QR refusé → inchangée, sur l’agro.
- délai de contestation de 72 h → inchangée, sur l’agro (contest_hours du module agro : 72).
- pas de déblocage avant la fin du délai / déblocage automatique après le délai → inchangées, sur l’agro.
- tranche 2 débloquée → « tranche débloquée (fonds RELEASED, statut PAID) » → RELEASED est désormais un état des fonds.
- événement de déblocage AUTO_TIMEOUT → inchangée, sur l’agro.
- (ajout) alerte TRANCHE_RELEASED au déblocage.
- activation des tranches exécutable → même libellé, renforcée : `activate_due_tranches() >= 1` (au lieu de >= 0).
- (ajout) jalon suivant soumis une fois le précédent terminé.
- (ajout) le prestataire ouvre un litige avant paiement.
- (ajout) paiement impossible pendant la suspension [TX_NOT_ACTIVE].
- (ajout) la partie adverse répond : médiation (IN_MEDIATION).
- (ajout) l’administrateur clôt le litige sans suite (RESOLVED/NO_ACTION).
- (ajout) suspension levée : demande payable, opération ACTIVE.
- (ajout) opération conditionnelle close : fonds libérés et demande restante annulée.
- (ajout) terrain : double validation exigée => revue du bureau malgré platform_review NEVER → PENDING_REVIEW.
- terrain : une validation ne suffit pas / le même validateur ne peut pas valider deux fois → inchangées.
- terrain : deuxième validateur distinct => validé → « … => opération active », = ACTIVE.
- rejet avec motif → « rejet avec motif : opération annulée », = CANCELLED/Devis illisible → REJECTED supprimé ; rejet ⇒ CANCELLED + reject_reason.
- abandon d'un dossier rejeté (D4) → « dossier rejeté : demande annulée d’office, alerte TX_REJECTED avec le motif » → l’abandon n’existe plus : le rejet est lui-même l’annulation définitive.
- un dossier rejeté revient en brouillon pour correction → « un dossier rejeté ne revient plus en brouillon (chemin de correction supprimé) » [TRANSITION_UNKNOWN] → REJECTED → DRAFT supprimé.
- un brouillon de correction (déjà audité) ne se supprime pas → remplacé par (1) « un dossier rejeté (déjà audité) ne se supprime pas » et (2) « un brouillon déjà audité (pièce consultée par le payeur) ne se supprime pas » (brouillon 7000… audité par get_document_access) → plus de brouillon de correction ; même règle D4 sur un brouillon audité.
- has_audit distingue dossier audité et brouillon vierge → même libellé, porte sur 5000… et 7000… (audités) contre 4000… (vierge).
- Les autres vérifications (structure RLS, isolation, paiements, journal, D4 suppression, profils) sont inchangées.

### Bug de migration soupçonné
Aucun : tous les comportements observés correspondent au modèle cible et au résumé.
Remarque : aucun module CONDITIONAL n’a release_mode = PROVIDER_CONFIRM par défaut (agro : PAYER_CONFIRM, terrain et immobilier : EVIDENCE_REVIEW). confirm_by_reference n’est donc atteignable qu’avec une configuration de module, ce qui semble voulu (« le code reste pour CONDITIONAL ») mais mérite d’être confirmé.

## supabase/tests/01_lot4.sql — mise à jour lot X version 2

Nombre de vérifications : 119 avant → 130 après.

### Jeu d’essai
- (ajout, pas une vérification) EDUCATION en `platform_review = ALWAYS` et `settlement_mode = CONDITIONAL`, HEALTH en `ALWAYS` (comme administrateur) → pour exercer la revue du bureau (validation, rejet motivé) et la libération conditionnelle (scan, déblocage, litige tranché par libération), qui ne sont plus le comportement par défaut. Le chemin par défaut (NEVER, DIRECT) est testé sur un nouveau dossier RENT (e3…07).

### Soumission, validation
- « dossier complet soumis » (statut SUBMITTED) → « dossier complet soumis : en attente de revue (platform_review ALWAYS) », statut PENDING_REVIEW → la soumission mène à PENDING_REVIEW (revue) ou ACTIVE (NEVER).
- « validation » (VALIDATED) → « validation : opération ACTIVE » → l’approbation active l’opération (VALIDATED n’existe plus).
- (supprimé) `simulate_system_transition` TOKEN_ISSUED / IN_PROGRESS (étapes sans vérification) → plus de statuts TOKEN_ISSUED / IN_PROGRESS ; l’activation suffit.
- (ajout) « activation : demande due soumise, jalon suivant programmé (RG-12) » : tranche 1 SUBMITTED, tranche 2 DRAFT → remplace la simulation AWAITING_PAYMENT (soumission automatique des demandes dues).
- « tranche non activée non payable » [NOT_PAYABLE] : `simulate_tranche_system(tr2,'PAID_LOCKED')` par le demandeur → `simulate_tranche_system(tr2,'PAID')` par le payeur, même code → seul le payeur paie ; PAID_LOCKED n’existe plus.
- (ajout) « paiement en CONDITIONAL : PAID, fonds bloqués (HELD) » → nouveau modèle de paiement (PAID + funds_state).
- « le demandeur ne confirme pas une tranche » [TRANSITION_FORBIDDEN] via `transition_tranche(…,'CONFIRMED')` → [PROVIDER_ONLY] via `confirm_by_reference` par le demandeur → la confirmation n’est plus un statut ; elle passe par le scan réservé au prestataire.
- « RLS : le demandeur ne lit que ses propres notifications » : compte PAYMENT_READY = 1 → compte TX_VALIDATED = 1 (alerte envoyée aux trois parties) → le demandeur ne reçoit plus d’alerte de demande soumise (destinée au payeur seul) ; même intention RLS.
- « PAYMENT_READY aux trois parties » → « PAYMENT_REQUEST_RECEIVED au payeur seul (demande soumise par le demandeur) », sans PAYMENT_READY → nouvelle règle d’alerte (payeur seul, PAYMENT_READY seulement si le payeur est l’initiateur).
- (ajout) « REQUEST_PAID aux trois parties » → nouvelle alerte de paiement exécuté.

### Confirmation par référence, déblocage
- « confirmation par référence (casse indifférente) » (statut CONFIRMED) → « … : confirmée, délai de contestation ouvert, fonds encore bloqués » : status PAID, funds_state HELD, confirmed_at renseigné, contest_ends_at futur → CONFIRMED n’est plus un statut.
- (étape) `transition_tranche(tr1,'RELEASED')` par le payeur → `approve_release(tr1)` ; (ajout) « libération anticipée par le payeur après confirmation : fonds RELEASED » (funds_state RELEASED, release_events PAYER_APPROVAL).
- Inchangés et réussis : TRANCHE_CONFIRMED avec releaseAt (3), NOT_RELEASED avant déblocage, TRANCHE_RELEASED (3), reçu, reçu refusé à un tiers, résolution de référence (tiers, payeur PROVIDER_ONLY, inconnue, heure future, TOKEN_USED).

### Litige
- (étapes) tr2 : `'AWAITING_PAYMENT'` puis `'PAID_LOCKED'` par le demandeur → `'SUBMITTED'` par le demandeur puis `'PAID'` par le payeur.
- (ajout) « litige après paiement : statut de la demande et de l’opération inchangés (K7) » → nouveau comportement (pas de DISPUTED, pas de suspension après paiement).
- « un validateur ne tranche pas un litige (RG-09) » : issue RELEASE_TO_PROVIDER → FUNDS_RELEASED, même code ADMIN_ONLY → nouvelles issues.
- « litige tranché par l’administrateur » (RELEASED_TO_PROVIDER) → « … (RESOLVED, FUNDS_RELEASED) » : status RESOLVED et outcome FUNDS_RELEASED → statut et issue séparés.
- « litige déjà clos » : issue REFUND_PAYER → REFUND_FULL, même code NO_OPEN_DISPUTE.
- « un administrateur partie ne tranche pas » : issue REFUND_PAYER → REFUND_FULL, même code VALIDATOR_IS_PARTY.
- « pas de TRANCHE_RELEASED en double après un litige » (= 3) : INCHANGÉE, ÉCHOUE (6 obtenues) → anomalie suspectée de 0014 (voir le rapport) ; la vérification garde le comportement attendu.

### Rejet
- « TX_REJECTED avec motif au payeur et au prestataire inscrit » : inchangée (réussit ; HEALTH en revue ALWAYS).
- « un dossier rejeté se corrige par save_draft (motif restitué) » → deux vérifications : « dossier rejeté : opération annulée avec son motif, demandes annulées » (CANCELLED, reject_reason, tranches CANCELLED) et « un dossier rejeté ne se corrige plus par save_draft » [NOT_EDITABLE] → le chemin REJECTED → DRAFT n’existe plus.
- « pièce d’un dossier audité archivée, pas supprimée », « ligne archivée conservée », « pièce archivée absente du brouillon » : même assertions, sur un nouveau brouillon HEALTH (e3…06) audité par la consultation journalisée d’une pièce par le prestataire (get_document_access, X4) → un dossier rejeté n’est plus un brouillon ; c’est désormais la seule façon d’obtenir un brouillon audité.

### Chemin par défaut (ajouts, dossier RENT e3…07)
- (ajout) « soumission sans revue (platform_review NEVER) : opération ACTIVE ».
- (ajout) « AUTO_ACTIVATED : demande due soumise, aucun jeton en DIRECT ».
- (ajout) « sans revue : ni TX_VALIDATED ni TX_REJECTED ; PAYMENT_REQUEST_RECEIVED au payeur ».
- (ajout) « règlement DIRECT : paiement → PAID sans blocage (DIRECT_PAYMENT), opération close ».
- (ajout) « règlement DIRECT : reçu disponible dès le paiement ».

### Démonstration
- (fixture) RENT passe en revue ALWAYS avant la soumission de e3…05 (demo_review exige un dossier en revue).
- « demo_review : validation jusqu’à IN_PROGRESS » → « demo_review : validation jusqu’à ACTIVE ».
- « demo_review : première tranche activée (RG-12) » (AWAITING_PAYMENT) → « demo_review : première tranche soumise (RG-12) » (SUBMITTED).
- (étape) paiement de tr5 : `'PAID_LOCKED'` par le demandeur → `'PAID'` par le payeur.
- « demo_resolve_dispute » (REFUNDED_TO_PAYER, issue REFUNDED) → « demo_resolve_dispute (remboursement total) » : issue REFUND_FULL, RESOLVED, refund_amount_minor 150000, refund_id renseigné.
- (ajout) « litige après paiement : remboursement créé, statut de la demande inchangé avant exécution ».
- « demo_reset n’efface que le journal des dossiers de l’appelant » : la liste inclut aussi e3…07 (créé par le demandeur).
- (ajout) « paiement simulé refusé hors mock_mode » [DEMO_DISABLED] avec simulate_tranche_system ; l’ancienne vérification simulate_system_transition est conservée.

## supabase/tests/02_lot5.sql — mise à jour lot X version 2

Nombre de vérifications : 133 avant → 143 après (vérifications exécutées ; 133 conservées ou remplacées, 10 ajoutées ; détail ci-dessous).

### Jeu d’essai
- Pas de vérification : `auto_issue_token` retiré de la mise à jour d’app_config (inutilisé), `update request_modules set platform_review = 'ALWAYS' where code = 'EDUCATION'` avant les soumissions → la file du bureau reste exercée.
- AJOUT : « platform_review : NEVER par défaut pour tous les modules (lot X v2, K2) » → K2, défaut posé par 0014.

### File, prise en charge, décision
- « bo_dossiers : statut, validations 0 sur 1, … » → « bo_dossiers : statut PENDING_REVIEW, … », status = 'PENDING_REVIEW' → la soumission passe en PENDING_REVIEW (SUBMITTED n’existe plus).
- « claim_dossier : SUBMITTED → IN_REVIEW » → « claim_dossier : PENDING_REVIEW → IN_REVIEW » → nouveau statut d’entrée.
- « prise en charge journalisée au nom du validateur » → from_status = 'PENDING_REVIEW' (même libellé) → idem.
- « approbation avec la case : dossier validé » → « … : opération active », = 'ACTIVE' → l’approbation active l’opération (VALIDATED n’existe plus).
- « dossier validé sorti de la file » → « dossier approuvé (ACTIVE) sorti de la file » → libellé seulement.
- « second validateur distinct : dossier validé » → « … : opération active », = 'ACTIVE' → idem.
- « rejet avec motif (espaces retirés) » → « … : opération annulée (CANCELLED, plus de retour en correction) », status = 'CANCELLED' → REJECTED supprimé, rejet = annulation.
- « doublon possible : approbation permise » → = 'ACTIVE' (même libellé) → idem.

### Preuve de jalon (CONDITIONAL)
- Données directes : opération ACTIVE, settlement_mode CONDITIONAL, tranche PAID + funds_state HELD (au lieu de IN_PROGRESS / EVIDENCE_SUBMITTED) ; la pièce est déposée par le prestataire via RLS (docs_insert_evidence : PAID + HELD) ; jeton de la demande émis par `_issue_tranche_token` (pour la recherche par eQR).
- AJOUT (remplace la ligne d’audit TRANCHE_CHANGE fabriquée) : « submit_evidence : le prestataire demande l’examen de sa preuve (PAID, fonds bloqués) » → l’entrée dans la file passe par submit_evidence.
- « preuve : première approbation, en attente de la seconde » (= EVIDENCE_SUBMITTED) → « … fonds toujours bloqués, en attente de la seconde » : PAID + HELD + evidence_submitted_at non nul → statut EVIDENCE_SUBMITTED remplacé par funds_state.
- « preuve : second validateur, tranche débloquée » (= RELEASED) → « … fonds libérés (PAID, RELEASED) » → libération sur funds_state.
- AJOUT : « libération par le bureau : release_events VALIDATOR_APPROVAL et alerte TRANCHE_RELEASED » → effet de la libération dans le nouveau modèle.

### Litiges
- Parcours : plus de simulate_system_transition TOKEN_ISSUED / IN_PROGRESS (tx1 déjà ACTIVE après approbation) ; paiement par simulate_tranche_system(tr,'PAID') en tant que payeur (tr2 soumise d’abord par 'SUBMITTED').
- « le prestataire donne sa version » → « … (litige en médiation) » : réponse non nulle et status = 'IN_MEDIATION' → respond_dispute fait passer en IN_MEDIATION.
- « un validateur ne tranche pas un litige » → issue REFUND_FULL au lieu de REFUND_PAYER (même code ADMIN_ONLY).
- « bo_disputes : auteur, motif, … montant de la tranche » → status 'IN_MEDIATION' au lieu de 'OPEN', plus tranche_status PAID, before_payment faux, on_hold faux, settlement_mode DIRECT, funds_state NONE → nouveaux statuts et colonnes.
- « note de décision obligatoire » → issue REFUND_FULL (même code REASON_REQUIRED).
- « administrateur : remboursement du payeur » (= REFUNDED_TO_PAYER) → « administrateur : remboursement intégral du payeur (REFUND_FULL, remboursement lié) » : RESOLVED + outcome REFUND_FULL + refund_amount_minor 400000 + refund_id → nouvelles issues.
- AJOUT : « litige tranché : la demande payée reste PAID tant que le remboursement n’est pas exécuté (K7) » → un litige ne change jamais le statut d’une demande payée ; ligne refunds PENDING.
- « tranche annulée, paiement remboursé » → « remboursement exécuté : demande REFUNDED, paiement remboursé » (après demo_settle_refund) : REFUNDED, refunded_minor 400000, payments REFUNDED → PAID → REFUNDED au lieu de CANCELLED.
- « journal : litige tranché par l’administrateur (remboursement) » → payload outcome = 'REFUND_FULL'.
- AJOUT (remplace l’intention « fonds libérés » impossible en DIRECT) : « règlement direct : fonds déjà versés, aucune libération à décider » [INVALID_OUTCOME] pour FUNDS_RELEASED.
- « administrateur : fonds libérés au prestataire » (RELEASE_TO_PROVIDER) → « administrateur : litige tranché en faveur du prestataire (NO_ACTION, paiement acquis) » → en DIRECT, la faveur du prestataire = aucune action.
- « bo_disputes : tranche débloquée, décision et auteur » → « bo_disputes : demande payée inchangée, décision et auteur » : tranche_status PAID, RESOLVED, NO_ACTION, auteur.
- « toutes les tranches terminées : transaction close » → inchangé (REFUNDED et PAID/NONE sont finaux).

### Journal
- « bo_audit : acteur affiché avec son rôle au dossier » → to_status = 'PENDING_REVIEW' (soumission) au lieu de SUBMITTED.
- « recherche par référence d’eQR (18 caractères) » → « … ; jeton en CONDITIONAL seulement » : jeton de la tranche de tx7 (en DIRECT aucun jeton n’est émis).

### Approbation (ex « Émission simulée du jeton »)
- « auto_issue_token (mock_mode) : jeton émis, transaction en cours » (= IN_PROGRESS) → « approbation : opération active directement (sans jeton ni auto_issue_token) » (= ACTIVE).
- « première tranche activée (RG-12) et alerte PAYMENT_READY » → « première demande due soumise (RG-12) et alerte PAYMENT_REQUEST_RECEIVED au payeur (non initiateur) » → l’initiateur est le demandeur, donc PAYMENT_REQUEST_RECEIVED.
- « bo_audit : étapes du système (jeton, en cours, activation) sans acteur » (3 lignes) → « bo_audit : étape du système (soumission de la demande) sans acteur » (1 ligne REQUEST_SUBMITTED) → plus d’étapes jeton / en cours.
- « hors mock_mode : aucune émission simulée, dossier VALIDATED » → « hors mock_mode : approbation → ACTIVE, sans simulation ».

### Démonstration, second facteur
- « demo_review : parcours inchangé (jeton, en cours) » (= IN_PROGRESS) → « demo_review : approbation → ACTIVE (lot X v2) ».
- « aal2 : décision acceptée » → = 'ACTIVE' au lieu de VALIDATED.

### AJOUT : parcours par défaut (platform_review = NEVER), tx10
- « platform_review NEVER : soumission → ACTIVE directement ».
- « activation automatique journalisée (AUTO_ACTIVATED), sans alerte TX_VALIDATED (aucune décision du bureau) ».
- « bo_dossiers : un dossier activé automatiquement n’entre pas dans la file » (section 5 du modèle).
- « claim_dossier sur un dossier actif : sans effet (reste ACTIVE, aucune prise en charge) ».
- « aucune décision sur un dossier hors revue » [NOT_IN_REVIEW].

## supabase/tests/03_lotx.sql : passage au noyau du lot X version 2 (0014 à 0016)

Nombre de vérifications : 111 avant, 115 après (aucune supprimée sans remplacement ; 4 ajoutées).

### Mise en place (hors vérifications)
- En-tête : prérequis 0001 à 0016, rappel du modèle v2.
- `auto_issue_token = 'true'` retiré (le noyau v2 émet le jeton à la soumission d’une demande, en CONDITIONAL seulement, sans ce réglage) ; remplacé par `update request_modules set enabled = true, release_mode = 'PROVIDER_CONFIRM' where code = 'AGRO'` (annulé à la fin).
- Dossier A : module AGRO (CONDITIONAL) au lieu d’EDUCATION (désormais DIRECT, donc sans jeton) ; pièce SUPPORTING_DOCUMENT ; validation par le bureau (IN_REVIEW, decide_tx) retirée : ACTIVE dès la soumission.
- Dossier B : validation par le bureau retirée ; plus de passage de RENT en IMMEDIATE (refusé par contrainte).
- Dossier F : module AGRO (CONDITIONAL) au lieu d’EDUCATION, pour que la demande porte un jeton (révocation par le prestataire initiateur) ; validation par le bureau retirée ; textes du message adaptés (« Quelle variété ? »).

### Vérifications
- « aucune fonction de 0008 (ni redéfinie) exécutable par anon » → même libellé, liste complétée de submit_operation et approve_release → nouvelles fonctions publiques utilisées par le test.
- « fonctions internes de 0008 non exécutables par authenticated » → « fonctions internes de 0008 et du noyau v2 non exécutables par authenticated » (+ _submit_request, _activate_operation, _set_tx_status, _set_funds_state, _close_operation_if_done) → couverture des fonctions internes du noyau.
- « eqr_image_enabled : true par défaut » → « eqr_image_enabled : false par défaut (QR hors du parcours direct, 0015) » → changement voulu par 0015.
- « dossier A en cours, tranche 1 à payer, jeton émis » → « dossier A actif dès la soumission (AUTO_ACTIVATED, CONDITIONAL), demande 1 soumise avec son jeton, demande 2 programmée sans jeton » → ACTIVE au lieu d’IN_PROGRESS, SUBMITTED au lieu d’AWAITING_PAYMENT, jeton émis à la soumission en CONDITIONAL.
- (ajout) « l’initiateur résout la référence de sa demande (0015) » → 0015 : l’initiateur fait partie de ceux qui résolvent une référence.
- « mode PROVIDER_CONFIRM : le paiement verrouille (inchangé) » → « CONDITIONAL, mode PROVIDER_CONFIRM : le paiement bloque les fonds (PAID, fonds HELD) » → PAID_LOCKED devient PAID + funds_state HELD ; simulation par simulate_tranche_system(…, 'PAID').
- « le prestataire confirme avec le jeton actif » (statut CONFIRMED) → « … (confirmation enregistrée, fonds encore bloqués) » : status PAID, funds_state HELD, confirmed_at renseigné → CONFIRMED n’est plus un statut.
- « transitions de tranche du lot X (miroir de transitionTranche) » (6 lignes AWAITING_PAYMENT/INFO_REQUESTED/REJECTED/RELEASED) → « transitions de demande du lot X en statuts v2 (décisions du payeur, paiement ACCEPTED → PAID, plus de déblocage direct) » : 5 couples v2 présents, aucune transition vers RELEASED, AWAITING_PAYMENT, PAID_LOCKED, CONFIRMED → nouvelle table 3.2.
- « pas de déblocage direct sans paiement (mode non IMMEDIATE) » [simulate RELEASED, NOT_PAID] → « pas de libération sans paiement (CONDITIONAL) » [approve_release, NOT_PAID] → la libération passe par approve_release sur funds_state ; même code.
- « pas de paiement pendant la demande d’informations » → même libellé, simulation 'PAID' au lieu de 'PAID_LOCKED' (NOT_PAYABLE inchangé).
- « l’initiateur répond : à payer de nouveau » (AWAITING_PAYMENT) → « … (SUBMITTED) » → nouveau statut.
- « retour à payer après réponse : pas de nouvelle alerte PAYMENT_READY (seulement celle de l’ouverture) » (3 PAYMENT_READY) → « retour à payer après réponse : pas de nouvelle alerte (seulement PAYMENT_REQUEST_RECEIVED au payeur à la soumission) » : une seule alerte, au payeur, aucune autre partie → alerte de soumission au payeur seulement, PAYMENT_REQUEST_RECEIVED car l’initiateur (demandeur) n’est pas le payeur.
- « une tranche confirmée reste ouverte : dossier en cours » (IN_PROGRESS) → « une demande confirmée aux fonds bloqués reste ouverte : opération active » (ACTIVE) → statut d’opération v2.
- « clôture avec une tranche débloquée et une tranche rejetée » → « clôture avec une demande aux fonds libérés et une demande rejetée » ; la libération passe par approve_release (payeur, après confirmation) au lieu de transition_tranche(…, 'RELEASED') → libération sur funds_state.
- (ajout) « opération close : plus de décision du payeur [TX_NOT_ACTIVE] » → nouvelle règle : décisions du payeur seulement sur une opération ACTIVE.
- (préparation X2.6, ajout) « IMMEDIATE refusé par contrainte (remplacé par settlement_mode = DIRECT) » → remplace la mise en IMMEDIATE de RENT, désormais refusée.
- (ajout) « RENT en règlement DIRECT par défaut » → DIRECT par défaut pour EDUCATION, HEALTH, RENT.
- « tranche du type de test en mode IMMEDIATE » → « opération RENT en règlement DIRECT, demande soumise, aucun jeton émis » → settlement_mode DIRECT remplace IMMEDIATE ; pas de jeton en DIRECT.
- « paiement direct : débloquée sans verrouillage » (RELEASED) → « paiement direct : payée sans blocage des fonds » (PAID, funds_state NONE) → comportement DIRECT.
- « événement DIRECT_PAYMENT, aucun passage par PAID_LOCKED » → « événement REQUEST_PAID, aucun blocage des fonds » (REQUEST_PAID avec tranche_to PAID ; aucun funds HELD dans le journal) → l’événement d’audit est REQUEST_PAID ; DIRECT_PAYMENT reste le déclencheur de release_events (vérification suivante, inchangée).
- « le prestataire autorisé soumet sa demande » (SUBMITTED) → « … (ACTIVE directement) » → platform_review = NEVER.
- « le prestataire ne soumet pas le brouillon d’un autre » [TRANSITION_FORBIDDEN] → même libellé [INITIATOR_ONLY] → code de submit_operation.
- « alerte de demande reçue : ni montant, ni nom, ni texte » → « … (type, dossier, demande) » : la charge utile contient aussi trancheId → l’alerte est émise par demande soumise.
- « pas d’alerte de demande reçue pour un dossier créé par le payeur ou un demandeur » → « dossier créé par le payeur : PAYMENT_READY, pas d’alerte de demande reçue ; celle-ci ne va qu’au payeur non initiateur » → v2 : un demandeur initiateur déclenche aussi PAYMENT_REQUEST_RECEIVED (au payeur) ; seul le dossier créé par le payeur reçoit PAYMENT_READY.
- « validation par le bureau de contrôle (inchangée) » (decide_tx → IN_PROGRESS) → « circuit commun : opération du prestataire active dès la soumission (AUTO_ACTIVATED), demande soumise » → plus de validation par le bureau avec platform_review = NEVER.
- « le prestataire initiateur répond » → même libellé, statut SUBMITTED au lieu d’AWAITING_PAYMENT.
- « le prestataire initiateur révoque avant paiement » → inchangée (dossier F en AGRO pour qu’un jeton existe).

Toutes les autres vérifications sont inchangées.

## supabase/tests/04_lotx_p2.sql — mise à jour vers le modèle cible v2 (0014–0016)

Nombre de vérifications : 123 avant (base actuelle, 0001–0012) → 139 après (répétition avec 0014, 0015, 0016).
Résultat : `RESULTAT : 139 vérifications, toutes réussies`.

### Outils et jeu d’essai (aucune vérification)
- En-tête : prérequis « 0001 à 0016 appliquées ».
- `t.module_draft` déplacé dans le jeu d’essai (utilisé dès X5 par le module conditionnel) ; définition en X6 retirée.
- `t.active_dossier` : plus de prise en charge ni de décision par un validateur (platform_review NEVER par défaut : la soumission rend l’opération ACTIVE) ; paramètre `p_kind` (pièce jointe, défaut ENROLMENT_CERTIFICATE) pour les modules de test.

### X4
- Aucune vérification modifiée (les pièces restent verrouillées une fois l’opération sortie du brouillon ; ACTIVE au lieu de SUBMITTED ne change rien aux contrôles).

### X5
- « dossier E en cours, tranche 1 à payer » (tranche AWAITING_PAYMENT) → « opération E active, demande 1 soumise (à payer), demande 2 programmée » (tx ACTIVE, e1 SUBMITTED, e2 DRAFT) → statuts v2, l’échéance lointaine reste programmée (RG-12).
- « start_payment : tentative en cours, montant de la tranche » → même assertion + demande ACCEPTED → start_payment fait désormais passer la demande SUBMITTED → ACCEPTED.
- « paiement réussi : … tranche payée (fonds bloqués) … » (PAID_LOCKED) → « … demande payée (PAID, règlement direct : aucun fonds bloqué) … » (PAID, funds_state NONE, paid_at) → EDUCATION est en DIRECT ; l’intention « fonds bloqués » est reprise par le bloc CONDITIONAL ajouté.
- AJOUT « règlement direct : événement DIRECT_PAYMENT, paiement puis versement au prestataire au journal » (e1) → en DIRECT le paiement déclenche release_events DIRECT_PAYMENT et le journal RELEASE.
- « événement en double … : DUPLICATE, rien de plus » : nombre de journaux de e1 attendu 1 → 2 (PAYMENT + RELEASE inchangés par le doublon) → le versement direct ajoute un journal légitime.
- « nouvelle clé sur une tranche payée » → « … sur une demande payée » (libellé seulement, même code NOT_PAYABLE).
- « remboursé en totalité : chaque compte de la tranche revient à zéro » (e1) → remplacé par deux vérifications sur e1 : « remboursements versés : demande PAID → REFUNDED, refunded_minor = 100 000 » (nouveau comportement) et « règlement direct remboursé en totalité : journal de la demande équilibré, remboursements dus soldés » → en DIRECT les fonds ont déjà été versés au prestataire (journal RELEASE), donc PARTNER_CASH et DUE_TO_PROVIDER ne reviennent pas à zéro ; l’intention « chaque compte revient à zéro » est conservée sur une demande CONDITIONAL aux fonds bloqués (voir plus bas).
- « IMMEDIATE : le paiement simulé (événement) débloque directement » (update release_mode = IMMEDIATE puis RELEASED) → AJOUT « mode IMMEDIATE refusé (contrainte) » + « DIRECT : demande soumise plus tôt, le paiement simulé (événement) la règle directement (PAID, aucun fonds bloqué) » (simulate_tranche_system 'SUBMITTED' au lieu de 'AWAITING_PAYMENT') → IMMEDIATE supprimé, remplacé par le règlement direct.
- « débloqué : événement DIRECT_PAYMENT, versement au prestataire au journal » → « réglé : … » (même assertion).
- AJOUT « opération E close : toutes ses demandes dans un état final » → clôture automatique (ACTIVE → CLOSED) du modèle v2.
- AJOUT bloc CONDITIONAL (module de test TEST_COND, PAYER_CONFIRM, CONDITIONAL ; dossiers e1/e2 → demandes k1, l1) :
  - « CONDITIONAL : paiement réussi, demande payée, fonds bloqués (HELD), paiement seul au journal » → reprend l’intention « fonds bloqués » de l’ancien PAID_LOCKED.
  - « fonds bloqués remboursés en totalité : chaque compte de la demande revient à zéro, demande REFUNDED » → reprend l’intention de l’ancien contrôle « chaque compte revient à zéro ».
  - « CONDITIONAL : fonds libérés après confirmation (RELEASED), versement au prestataire au journal » (confirm_service puis approve_release).
  - « fonds conditionnels libérés au prestataire : remboursement refusé [NOT_REFUNDABLE] » → nouvelle règle de request_refund.
- « échec du paiement : tentative échouée, tranche toujours à payer » (AWAITING_PAYMENT) → « … demande de nouveau à payer (ACCEPTED → SUBMITTED) » (SUBMITTED) → retour à SUBMITTED quand aucune tentative n’est en cours ni réussie.
- « nouvelle tentative après un échec : payée » : PAID_LOCKED → PAID.
- « tranche remboursée en totalité mais toujours ouverte, événements rejetés … : signalés » (REFUNDED_TRANCHE_OPEN + EVENT_REJECTED) → « demande remboursée (REFUNDED) : pas d’écart de statut ; événements rejetés … : signalés » (['EVENT_REJECTED'], tranche_status REFUNDED) → le remboursement passe maintenant la demande à REFUNDED : plus d’écart sur le parcours normal.
- AJOUT « écart volontaire : remboursement versé mais demande non marquée remboursée, signalé (REFUNDED_TRANCHE_OPEN) » (e1 remise à PAID par le propriétaire de la base) → la détection de REFUNDED_TRANCHE_OPEN reste couverte.
- AJOUT « règlement conditionnel cohérent (remboursé, libéré) : aucun écart ; état des fonds exposé » → nouvelle colonne funds_state de v_reconciliation et cas CONDITIONAL.

### X6
- « amorçage : … platform_review ALWAYS et un seul payeur partout » → « … platform_review NEVER (défaut de la colonne et lignes existantes, K2) … » (lignes NEVER + column_default 'NEVER') → K2.
- AJOUT « amorçage : vague 1 en règlement direct, vague 2 en conditionnel ; aucune expiration configurée ; plus de mode IMMEDIATE » → nouvelles colonnes settlement_mode et request_expiry_days.
- « un utilisateur ne crée pas de type de besoin » : release_mode 'IMMEDIATE' → 'PAYER_CONFIRM' dans l’insertion refusée → sinon l’échec viendrait aussi de la contrainte request_modules_no_immediate et ne prouverait plus le refus des droits.
- « NEVER : validation automatique par le système (AUTO_VALIDATED), sans validateur, puis jeton et tranche » → « NEVER : activation automatique à la soumission (AUTO_ACTIVATED, DRAFT → ACTIVE), sans validateur ; demande due soumise » (statut ACTIVE, événement AUTO_ACTIVATED de DRAFT à ACTIVE, payload mode NEVER, aucune validation, demande SUBMITTED ; l’acteur est l’initiateur qui soumet, plus null) → nouveau nom d’événement et passage direct à ACTIVE.
- « NEVER : alerte de validation comme après une décision du bureau » (TX_VALIDATED) → « NEVER : alerte de demande à payer au payeur ; aucune alerte de validation » (PAYMENT_READY présent, TX_VALIDATED absent) → _notify_from_audit n’émet TX_VALIDATED qu’après PENDING_REVIEW/IN_REVIEW ; l’alerte TX_VALIDATED après décision du bureau est vérifiée sur le module ALWAYS (ajout ci-dessous).
- « NEVER au seuil : file du bureau, deux validateurs exigés » : statut SUBMITTED → PENDING_REVIEW.
- AJOUT « RISK_BASED : seuil de montant non configuré → bureau de contrôle (prudence) » (réglage risk_review_threshold supprimé, raisons ["THRESHOLD_NOT_CONFIGURED"]) → nouvelle règle de risque ; le seuil {"XAF": 100000} est ensuite posé pour les cas suivants.
- « RISK_BASED : … validation automatique » (IN_PROGRESS) → « … activation automatique » (ACTIVE + AUTO_ACTIVATED mode RISK_BASED).
- « RISK_BASED : doublon possible → bureau de contrôle » : SUBMITTED → PENDING_REVIEW.
- « RISK_BASED : première demande de ce demandeur → bureau de contrôle » : SUBMITTED → PENDING_REVIEW.
- AJOUT « RISK_BASED : montant au-delà du seuil configuré → bureau de contrôle » (["AMOUNT_THRESHOLD"]).
- « ALWAYS (défaut) : file du bureau, comme avant » (dossier C) → « NEVER (défaut) : aucune revue, opération active dès la soumission » (raisons [], C ACTIVE) → le défaut est NEVER ; le comportement ALWAYS est vérifié par un module de test TEST_ALWAYS :
  - AJOUT « ALWAYS : file du bureau (PENDING_REVIEW), demande pas encore soumise ».
  - AJOUT « ALWAYS : approuvé par le bureau → ACTIVE, demande soumise, alerte de validation (TX_VALIDATED) ».
- « needs_platform_review : vrai pour un module ALWAYS » (sur AGRO, alors ALWAYS) → déplacée sur le brouillon TEST_ALWAYS (même libellé) ; sur AGRO remplacée par « needs_platform_review : faux pour un module NEVER (défaut) ».

### X7
- Aucune vérification modifiée.

## Passe 2, X4 (0020) : niveaux d’enrôlement

### Jeu d’essai (sans vérification)

- `00_smoke.sql`, `01_lot4.sql`, `02_lot5.sql`, `03_lotx.sql`, `05_lotx2_p1.sql` : le demandeur du jeu d’essai est relevé à N1 (`update profiles set enrolment_level = 'N1'`, comme après la revue d’un dossier). Pourquoi : `save_draft` exige désormais N1 pour initier en demandeur. Aucun contrôle n’est modifié par ce réglage.

### Vérifications remplacées (`03_lotx.sql`, partie « demandes initiées par un prestataire »)

| Avant | Après | Pourquoi |
|---|---|---|
| prestataire sans autorisation refusé [`INITIATION_NOT_ALLOWED`] | prestataire sans le niveau N2 refusé [`ENROLMENT_REQUIRED`] | `can_initiate_requests` remplacée par le niveau (K3) |
| un utilisateur ne s’accorde pas l’autorisation d’initier (échec quelconque) | un utilisateur ne s’accorde pas de niveau d’enrôlement [`PROFILE_PROTECTED`] | même garantie, sur la nouvelle colonne, avec un code stable |
| autorisation inchangée (`can_initiate_requests` faux) | niveau inchangé (N0) | idem |

Le réglage du jeu d’essai `can_initiate_requests = true` du prestataire autorisé devient `enrolment_level = 'N2'`.

### Nouveau test

`06_lotx2_p2.sql`, partie X4 : 60 vérifications (droits, niveau protégé, initiation selon le niveau, KYC simulé approuvé, refusé ou en revue, revue par le personnel, bucket `identity` et consultations journalisées, N2 puis N3, contrôle à la soumission, adaptateur réel réservé au rôle service, journal immuable, plafonds).

## Passe 2, X5 (0021) : statuts de tentative et de remboursement du modèle cible

Pourquoi : la section 3.3 du modèle cible fixe les statuts d’une tentative (INITIATED, PENDING, CONFIRMED, FAILED) et ceux d’un remboursement (REQUESTED, EXECUTED, FAILED). Chaque contrôle garde son intention ; seule la valeur attendue change.

| Test | Contrôle | Avant | Après |
|---|---|---|---|
| `00_smoke.sql` | remboursement intégral créé (en attente d’exécution), demande encore PAID | `refunds.status = 'PENDING'` | `'REQUESTED'` |
| `02_lot5.sql` | litige tranché : la demande payée reste PAID tant que le remboursement n’est pas exécuté | `'PENDING'` | `'REQUESTED'` |
| `05_lotx2_p1.sql` | REFUND_FULL sur fonds bloqués : remboursement lié créé | `'PENDING'` | `'REQUESTED'` |
| `04_lotx_p2.sql` | start_payment : tentative créée, demande ACCEPTED (libellé ajusté) | tentative `'PENDING'` | `'INITIATED'` (en cours seulement après l’événement PAYMENT_PENDING) |
| `04_lotx_p2.sql` | signature invalide : événement enregistré, jamais appliqué | tentative toujours `'PENDING'` | toujours `'INITIATED'` |
| `04_lotx_p2.sql` | montant différent : événement rejeté | tentative toujours `'PENDING'` | toujours `'INITIATED'` |
| `04_lotx_p2.sql` | paiement réussi : tentative réussie, demande payée | `'SUCCEEDED'` | `'CONFIRMED'` |
| `04_lotx_p2.sql` | hors d’ordre : « en cours » après la réussite ignoré, la réussite reste | `'SUCCEEDED'` | `'CONFIRMED'` |
| `04_lotx_p2.sql` | même clé après la réussite : même résultat | `->>'status' = 'SUCCEEDED'` | `'CONFIRMED'` |
| `04_lotx_p2.sql` | écart volontaire du rapprochement (jeu d’essai, sans vérification) | `update … set status = 'SUCCEEDED'` | `'CONFIRMED'` |

Les codes d’écart (`SUCCEEDED_WITHOUT_EVENT`…) et les types d’événement (`PAYMENT_SUCCEEDED`) sont inchangés. La table `payments` (lot 1) garde ses propres statuts.

`06_lotx2_p2.sql`, partie X5 : 39 vérifications (droits, statuts, devis dans la devise de la demande et en EUR, taux non inventé, frais par poste, devis figé, expiré, inconnu, plafond dépassé ou absent, accepter et payer, contribution, rejeu, tentative en cours, événement « en cours », échec puis nouvelle tentative, devis à usage unique, frais au journal dans la devise débitée, rapprochement, remboursement demandé puis exécuté à la main, contrepassation, partiel puis total, jamais au-delà du payé).

## Passe 2, X6 (0022, 0023) : santé à données minimales, types de pièce prévus

Pourquoi : K13 (décision D2 corrigée). La santé ne demande plus que le devis, n’enregistre qu’une référence du patient, et refuse la pièce d’identité et le certificat médical.

| Test | Contrôle | Avant | Après |
|---|---|---|---|
| `00_smoke.sql` | rejet avec motif ; dossier rejeté (jeu d’essai) | dossiers santé avec devis et pièce d’identité, sans référence | devis seul, `beneficiary_reference` posée (P-001, P-002) |
| `01_lot4.sql` | pièces obligatoires D2 en base | 7 | 6 (santé : le devis seul) |
| `01_lot4.sql` | pièce obligatoire manquante (pièce d’identité, D2) [`DOCUMENT_REQUIRED`] | soumission refusée sans pièce d’identité | **remplacé** : pièce d’identité du bénéficiaire refusée pour la santé [`DOCUMENT_KIND_NOT_ALLOWED`]. `DOCUMENT_REQUIRED` reste couvert par `04_lotx_p2.sql` (pièce obligatoire du module manquante) |
| `01_lot4.sql` | save_draft conserve les pièces | 2 pièces | 1 (le devis) |
| `01_lot4.sql` | brouillons santé (jeu d’essai) | `beneficiaryName` « Maman » | `beneficiaryReference` « MN » |
| `04_lotx_p2.sql` | required_documents (vue) : pièces de la vague 1 | santé : devis, pièce d’identité, certificat | santé : devis seul |
| `04_lotx_p2.sql` | pièce obligatoire du module manquante | une pièce `OTHER` (non prévue) déposée avant | le module de test prévoit une pièce facultative `PHOTO`, déposée à la place ; **ajout** : `OTHER` refusé [`DOCUMENT_KIND_NOT_ALLOWED`] (140 contrôles au lieu de 139) |

`06_lotx2_p2.sql`, partie X6 : 20 vérifications (module santé, autres modules, sensibilité, mode inconnu, nom refusé, référence invalide, référence requise, référence enregistrée sans nom, pièce d’identité et certificat refusés, devis seul suffit, consultation d’une pièce sensible sans nom ni chemin, aucune donnée de santé dans le journal ni les alertes, pièce ordinaire inchangée, module ajouté par une ligne de données de bout en bout, vague 2 refusée, preuve de jalon acceptée (0023), type non prévu refusé).

## Lot X-C : corrections avant la passe 3 (0024 et suivantes)

Nouveau script `supabase/tests/07_lotxc.sql` (et sa variante éditeur), une section par tâche du lot. Aucun contrôle des
scripts 00 à 06 n’est modifié par ce lot sauf mention contraire ci-dessous. Règle d’écriture : la RLS filtrant en
silence, un `UPDATE` interdit est vérifié par le nombre de lignes touchées (`t.n_updated`) **et** par la valeur relue.

### T3 (0024) : brouillons d’opération — 21 vérifications
- La politique `tx_update_draft` n’existe plus : le créateur d’un brouillon ne modifie plus `beneficiary_name`,
  `settlement_mode`, `initiator_id`, `status` ni `purpose` par écriture directe (0 ligne touchée, valeur inchangée) ;
  `save_draft` reste le seul chemin.
- Soumission d’un brouillon falsifié (données posées hors RLS, comme avant 0024) : nom sur un module à référence seule
  refusé (`BENEFICIARY_NAME_NOT_ALLOWED`) ; mode de règlement recalculé depuis `request_modules` ; `initiator_id`
  différent du créateur refusé (`INITIATOR_MISMATCH`, nouveau code) — et le créateur dépossédé reçoit `INITIATOR_ONLY`.

### T4 (0025) : profils et numéro de téléphone — 7 vérifications
- `phone` rejoint les colonnes protégées de `guard_profile` (`PROFILE_PROTECTED`) : changer son propre numéro est
  refusé, la valeur est relue inchangée ; `full_name`, `country` et `push_enabled` restent modifiables (1 ligne).
- Unicité du numéro **normalisé** (`profiles_phone_norm_key`) : une autre graphie d’un numéro existant est refusée,
  même hors RLS ; une inscription en doublon normalisé échoue à la création du profil.
- Le numéro vérifié de `auth.users` est recopié dans `profiles` (`on_auth_user_phone_changed`) : seul flux légitime.
