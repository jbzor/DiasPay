# Sécurité du TrustLink : état réel

## État au 17 novembre 2026 (après 0015, 0016 et le lot X-C, migrations 0024 à 0031)

Ce qui a changé depuis le tableau de la passe 1, plus bas (conservé pour l’historique) :

- **Un TrustToken pour chaque demande, y compris en règlement direct** (Xc-7, 0028) : émis à la soumission, journalisé
  (`TOKEN_ISSUED`). La passe 2 l’avait réservé au `CONDITIONAL` : écart avec l’exigence 5.1, corrigé. Le lien
  partageable reste supprimé, et l’image du QR désactivée par défaut (`eqr_image_enabled` faux, 0015 ; réglage absent =
  image masquée, Xc-9).
- **Durée de validité** : jusqu’au paiement, le jeton suit l’échéance de la demande (vide tant que la durée des
  demandes n’est pas fixée, point ouvert 3) ; en `CONDITIONAL`, `token_ttl_days` ne s’applique qu’à la phase de
  confirmation, à compter du paiement (0031).
- **Révocation** : à chaque statut final de la demande et à l’annulation de l’opération (déclencheur, 0028) ; un jeton
  révoqué ou absent bloque le paiement (`TOKEN_REVOKED`).
- **Résolution** (0015) : en `DIRECT`, seuls le payeur et l’initiateur résolvent la référence ; le prestataire seulement
  en `CONDITIONAL`. Même réponse nulle pour une référence inconnue ou étrangère.
- **Jeton de présentation** (0016, K4) : empreinte SHA-256 seulement, usage unique, rotation. Depuis 0026, un payeur
  invité par téléphone ne peut être pris en charge que par le titulaire du numéro vérifié, numéro que son titulaire ne
  modifie plus (0025).
- **`anon`** n’exécute plus aucune fonction du schéma `public` et ne lit plus `app_config` (0029).
- Restent **absents** : signature réelle (Ed25519, TrustEngine), vérification hors ligne, affichage du TrustToken et du
  DiasPay Link dans l’espace de vérification du payeur (lot Y).

## Passe 1 (12 novembre 2026)


Brouillon pour le kickoff. Référence : exigence 5.1 du « Cahier d’extension fonctionnelle de DiasPayQR ». État vérifié le 12 novembre 2026 sur le projet de développement (`supabase/tests/03_lotx.sql`, 111 contrôles) et par les tests automatiques (`packages/domain/test/lotx.test.ts`, `apps/mobile/test/trustlink.test.ts`, suite de contrat).

Légende : **couverte** (en place et testée), **partielle** (en place, avec une limite nommée), **absente**.

| Exigence 5.1 | État | Ce qui est en place | Ce qui manque |
|---|---|---|---|
| Lien jamais transmis par WhatsApp, SMS ou e-mail | **Couverte** | Aucun lien n’existe : plus de partage, copie, enregistrement ni adresse ; les gabarits externes sont des textes fixes sans adresse ni paramètre (test d’architecture). | Aucun canal externe n’est encore branché : la règle devra être tenue par le futur service d’envoi (passer par `externalNotification()`). |
| Lien authentique seulement dans l’application, après connexion | **Couverte** | L’eQR n’est affiché qu’au payeur connecté, pour sa tranche payée ; le jeton ne se lit que par le payeur (RLS) ; aucune adresse externe n’ouvre l’application. | — |
| Liens authentifiés et signés | **Absente** | Le jeton porte une signature **simulée** (`kid = SIMULATED`). | Signature réelle (Ed25519) et clés publiques (`signing_keys`) par le TrustEngine ; vérification hors ligne par l’application du prestataire. |
| Durée de validité contrôlée | **Partielle** | Expiration à 7 jours (`token_ttl_days`), contrôlée par le serveur à la confirmation (`TOKEN_EXPIRED`), heure de l’appareil bornée (`DEVICE_TIME_INVALID`). | Durée définitive à décider ; aucune expiration de la tranche en `INFO_REQUESTED`. |
| Révocation possible | **Couverte** | `revoke_token`, `reissue_token` (initiateur avant paiement, administrateur non partie toujours), motif obligatoire, journalisé ; jeton révoqué refusé partout (`TOKEN_REVOKED`) ; révocation automatique au rejet. | Écran de révocation (lot Y) et écran du personnel. |
| Protection contre le rejeu | **Partielle** | Usage unique (`TOKEN_USED`), confirmation seulement sur une tranche payée, référence de 72 bits aléatoire, verrou de ligne à la confirmation. | Sans signature réelle, un QR photographié reste valable jusqu’à son usage ou sa révocation : la capture d’écran est bloquée sur l’appareil du payeur, pas la photo d’un autre appareil. |
| Protection contre la substitution de destinataire | **Couverte** | Une référence n’est résolue et confirmée que par une partie au dossier ; un étranger reçoit exactement la réponse d’une référence inconnue (test explicite) ; seul le prestataire du dossier confirme. | — |
| Intégrité des paramètres | **Partielle** | Le QR ne porte que référence, `kid` et signature ; montant, bénéficiaire et état sont relus sur le serveur à chaque résolution. | Signature réelle : la référence et le `kid` ne sont pas encore authentifiés cryptographiquement. |
| Authentification avant toute action sensible | **Partielle** | Toute fonction exige une session (`NOT_AUTHENTICATED`), aucune n’est exécutable par `anon` ; la confirmation par le prestataire demande la biométrie de l’appareil (lot 3). | Authentification multifacteur selon le risque côté utilisateur (exigence 5.2, hors lot). |
| Protection contre l’hameçonnage | **Partielle** | Aucun lien à imiter ; gabarits e-mail et WhatsApp rappelant que DiasPay n’envoie jamais de lien de paiement ; écran du jeton : « Présentez ce QR en personne ». | Domaine d’envoi authentifié (SPF, DKIM, DMARC), expéditeur SMS déclaré : à définir avec les canaux. |
| Protection contre les redirections | **Couverte** | Aucune adresse `https` n’ouvre l’application ; `diaspay://` n’accepte que `tranche/<identifiant>` (jamais une référence) ; toute autre adresse est ignorée (`+native-intent.tsx`, testé). Aucune redirection ouverte côté serveur. | — |
| Détection des comportements suspects | **Partielle** | Plus de 10 résolutions échouées par heure : refus (`TOO_MANY_ATTEMPTS`) et événement `SUSPICIOUS_ACTIVITY` (`security_events`, lecture par le personnel). | Écran du personnel, alertes, autres signaux (lot ultérieur) ; les échecs à la confirmation ne sont pas comptés (limite appliquée quand même). |

## Ce qui dépend du TrustEngine

- Signature réelle des jetons et publication des clés (`signing_keys.public_key`).
- Vérification hors ligne de l’eQR par le prestataire (vague 2).
- Signature des jetons en production. L’émission elle-même se fait à la soumission de chaque demande, sans réglage (`auto_issue_token` supprimé par 0031).
