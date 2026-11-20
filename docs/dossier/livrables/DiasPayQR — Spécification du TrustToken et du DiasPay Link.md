# DiasPayQR — Spécification du TrustToken et du DiasPay Link

Nov 17, 2026 · @jb.nzudie

## Objet et statut

Ce document répond aux livrables 7 (spécification du TrustToken) et 8 (spécification technique du TrustLink) de la section 7 du cahier d’extension fonctionnelle. **C’est une version de travail, soumise au Dr Dongmo pour validation écrite**, en remplacement de la réunion de cadrage qui n’a pas pu avoir lieu.

Il décrit à la fois la règle et l’état réel du code au 17 novembre 2026 (branche `master`, étiquette `pre-passe3`, migrations 0001 à 0031). Ce qui est simulé ou reste à faire est dit comme tel.

**Sources, par ordre d’autorité** : (1) cahier d’extension fonctionnelle de DiasPayQR ; (2) message du Dr préparant le kickoff ; (3) dossier institutionnel Diaspora Business Hub 237 ; (4) réponses écrites du Dr aux questions K1 à K14. Les références entre crochets renvoient à ces documents : \[Cahier §5.1\], \[Message, cas 2 A\], \[Institutionnel\].

**Vocabulaire** : « demande » = demande de paiement (une échéance d’un plan en est une) ; « opération » = le dossier qui regroupe les demandes ; « initiateur » = celui qui crée la demande ; « mode direct » = paiement exécuté immédiatement au prestataire ; « mode conditionnel » = fonds conservés par un partenaire habilité jusqu’à confirmation.

## En bref

**Le TrustToken est la carte d’identité numérique d’une demande de paiement.** Chaque demande, et chaque échéance d’un plan, en reçoit un au moment où elle est soumise. Il porte une référence unique et un état (actif, révoqué, expiré, utilisé). Sans TrustToken actif, aucun paiement n’est possible.

**Le DiasPay Link (nom institutionnel du TrustLink) est la porte d’entrée vers cette demande, et il n’existe que dans l’application DiasPay.** Ce n’est pas une adresse web qu’on pourrait recevoir par SMS, WhatsApp ou e-mail. Le payeur ouvre l’application, se connecte, retrouve la demande dans sa liste, et c’est là qu’il trouve le DiasPay Link qui ouvre l’espace de vérification.

**Ce que le payeur reçoit à l’extérieur de l’application** : un message fixe du type « Une nouvelle demande vous attend dans DiasPay », sans lien, sans nom et sans montant. Un escroc ne peut donc pas imiter un « vrai lien » : il n’en existe aucun.

**Ce que le payeur voit dans l’application** : l’identité vérifiée du demandeur, le montant, l’objet, les justificatifs, les éventuelles déclarations de témoins, l’historique, puis ses quatre choix : accepter et payer, demander des informations, contester, rejeter.

**Aucune image de QR n’est nécessaire pour une demande** \[Message, cas 1 étape 4\]. Le QR reste réservé au paiement en présence d’un commerçant (PAYQR), qui suit ses propres règles (voir plus bas).

## Exigences du client

Douze exigences encadrent ces deux mécanismes ; elles viennent toutes des documents du client.

| # | Exigence | Source |
| --- | --- | --- |
| E1 | Tout paiement est associé à un TrustToken et à un TrustLink authentifié | \[Cahier §1\] |
| E2 | Chaque demande soumise génère un « eQR logique » : un TrustToken et un TrustLink, sans image de QR | \[Message, cas 1 étape 4\] |
| E3 | Chaque échéance d’un plan garde son propre identifiant, son propre TrustToken et son propre dossier de preuves | \[Cahier, cas 8\] |
| E4 | Le TrustToken est généré juste après la soumission et figure dans la chronologie | \[Cahier §3.C\] |
| E5 | Le TrustToken est l’identité numérique de chaque opération | \[Institutionnel, DiasPayQR\] |
| E6 | Le TrustLink n’est jamais transmis par WhatsApp, SMS ou e-mail ; le payeur le retrouve dans l’environnement sécurisé de DiasPay | \[Message, cas 2 A\] ; \[Cahier §3.D\] |
| E7 | Liens authentifiés et signés cryptographiquement ; validité contrôlée ; révocation ; anti-rejeu ; anti-substitution de destinataire ; intégrité des paramètres ; authentification avant toute action sensible ; protection contre l’hameçonnage et les redirections | \[Cahier §5.1\] |
| E8 | Traçabilité complète des consultations et des opérations ; détection des comportements suspects | \[Message, cas 2 A\] |
| E9 | Le payeur voit l’identité du demandeur, le montant, l’objet, la prestation, les justificatifs, les validations de témoins, l’historique | \[Message, cas 2 B\] |
| E10 | Le DiasPay Link ouvre la demande, les justificatifs, le marchand, l’historique, le choix du moyen de paiement et la validation biométrique | \[Institutionnel, DiasPay\] |
| E11 | Confirmation explicite du montant et du bénéficiaire ; authentification multifacteur selon le risque | \[Cahier §5.2\] |
| E12 | Le TrustToken et le TrustLink font partie de la phase 1 (priorité 3) | \[Cahier §6\] |

## Livrable 7 — Le TrustToken

**Un TrustToken est émis par le serveur pour chaque demande, au moment de sa soumission, quel que soit le mode de règlement ; il ne quitte jamais le serveur que pour être affiché, dans l’application, aux seules parties autorisées.** Depuis le 17 novembre 2026, c’est le comportement du code (migrations 0028 et 0031).

### Ce qu’il contient

| Élément | Rôle | État |
| --- | --- | --- |
| Référence | Identifiant opaque de 72 bits tirés au hasard (18 caractères hexadécimaux, affichés par blocs de 4) ; ne révèle rien de la demande | En place |
| Demande liée | La demande (ou l’échéance) dont le jeton est l’identité ; un seul jeton actif par demande | En place |
| État | Actif, révoqué, utilisé (confirmation en mode conditionnel), expiré | En place |
| Dates | Émission ; échéance (voir « Validité ») | En place |
| Identifiant de clé et signature | Permettront de prouver que le jeton vient bien de DiasPayQR | **Simulés** (`SIMULATED`) jusqu’au TrustEngine |
| Motif de révocation | Obligatoire, journalisé | En place |

**Le jeton ne contient jamais** de montant, de nom, de numéro de téléphone ni de donnée de santé. Montant, bénéficiaire et état sont relus sur le serveur à chaque consultation : rien de ce que l’appareil affiche ne fait foi sans cette relecture.

### Règles

1. **Émission** : à la soumission de la demande, sans condition de réglage ; l’événement « TrustToken généré » (`TOKEN_ISSUED`) entre dans la chronologie et le journal d’audit chaîné. Une demande en brouillon n’a pas de jeton (`NO_TOKEN`).
2. **Validité** : jusqu’au paiement, le jeton suit l’échéance de la demande, dans les deux modes. Tant qu’aucune durée d’expiration des demandes n’est fixée, cette échéance est vide et la validité est contrôlée par le cycle de vie de la demande (règle 3). En mode conditionnel, une durée de confirmation (`token_ttl_days`, 7 jours en développement) court à partir du paiement.
3. **Révocation** : automatique quand la demande est rejetée, expirée ou annulée, à l’annulation de l’opération et, en mode direct, dès que la demande est payée ; le jeton révoqué est conservé, jamais supprimé, et sa référence reste sur le reçu ; le payeur ou l’initiateur qui la consulte reçoit \`TOKEN\_REVOKED\`, toute autre personne une réponse nulle ; en mode conditionnel, le jeton reste actif après le paiement, le temps de la confirmation, puis devient « utilisé » ; manuelle par l’initiateur avant paiement, ou par un administrateur qui n’est pas partie au dossier, motif obligatoire.
4. **Réémission** : remplace un jeton révoqué par un nouveau, avec une nouvelle référence ; l’ancien reste révoqué et tracé. La réémission doit être refusée sur une demande terminée (payée en mode direct, rejetée, expirée, annulée, remboursée) ; elle reste permise pendant la confirmation en mode conditionnel. \*\*Correctif prévu\*\* : aujourd’hui, un administrateur non partie peut encore réémettre sur une demande terminée.
5. **Paiement** : refusé si la demande n’a pas de jeton actif (`TOKEN_REVOKED`).
6. **Résolution** (retrouver une demande à partir de sa référence) : réservée au payeur et à l’initiateur, et au prestataire en mode conditionnel. Toute autre personne reçoit exactement la même réponse qu’une référence inconnue : elle ne peut pas savoir si la demande existe.
7. **Limitation** : plus de 10 résolutions échouées par heure pour un même utilisateur entraînent un refus (`TOO_MANY_ATTEMPTS`) et un événement `SUSPICIOUS_ACTIVITY` visible par le bureau de contrôle.
8. **Journalisation** : émission, révocation, réémission, consultations et échecs sont horodatés et rattachés à leur auteur dans le journal d’audit, qui n’accepte que des ajouts.

### Codes renvoyés

| Code | Signification |
| --- | --- |
| `NO_TOKEN` | Demande pas encore soumise |
| `TOKEN_REVOKED` | Jeton révoqué, ou demande sans jeton actif |
| `TOKEN_EXPIRED` | Échéance dépassée (confirmation en mode conditionnel) |
| `TOKEN_USED` | Jeton déjà utilisé pour la confirmation |
| `TOO_MANY_ATTEMPTS` | Trop de résolutions échouées dans l’heure |
| `DEVICE_TIME_INVALID` | Heure de l’appareil incohérente |

## Livrable 8 — Le DiasPay Link (TrustLink)

**Le DiasPay Link est une action dans l’application, pas une adresse : il n’existe qu’après connexion, il ne s’ouvre qu’à l’intérieur de DiasPay, et il mène à l’espace de vérification d’une demande dont le TrustToken est actif.** Aucune adresse web, aucun lien copiable et aucun QR ne le représente à l’extérieur.

### Comment le payeur y accède

1. Il reçoit, hors de l’application, un message fixe sans lien, sans nom et sans montant (« Une nouvelle demande vous attend dans DiasPay »). Le message rappelle que DiasPay n’envoie jamais de lien de paiement.
2. Il ouvre l’application **par ses propres moyens** (icône, ou plus tard domaine officiel saisi à la main) et se connecte \[Cahier §3.D\].
3. La demande apparaît dans sa liste, parce qu’il en est partie (payeur invité, rattaché par son numéro de téléphone vérifié).
4. Il ouvre le DiasPay Link de cette demande : le serveur vérifie la session, la qualité de partie et l’état du jeton, puis renvoie le contenu de l’espace de vérification.

### Ce que l’espace de vérification affiche

| Bloc | Contenu | Source |
| --- | --- | --- |
| Demandeur | Identité **vérifiée** (nom figé à partir du niveau N1, numéro vérifié), niveau d’enrôlement | \[Message, cas 2 B\] ; \[Cahier §5.1\] |
| Demande | Montant, devise, objet, nature de la prestation, bénéficiaire final s’il diffère, échéance | \[Message, cas 1 étape 2\] |
| Paiement | Montant indicatif dans la devise du payeur, taux et source, frais détaillés, total débité, moyens disponibles | \[Cahier, cas 13\] ; \[Institutionnel, DiasPay\] |
| Preuves | Justificatifs (chaque ouverture est journalisée), alerte si une même pièce a déjà servi ailleurs | \[Cahier §3.B, innovation C\] |
| Témoins | Déclarations des témoins, présentées comme des déclarations et jamais comme des certifications | \[Cahier, cas 25\] |
| Historique | Chronologie de la demande, dont « TrustToken généré » | \[Cahier §3.C\] |
| Référence | Référence du TrustToken et son état | \[Message, cas 2 A\] |
| Décision | Accepter et payer · Demander des informations · Contester · Rejeter ; validation biométrique avant de payer | \[Message, cas 2 B\] ; \[Institutionnel, DiasPay\] |

### Protections

- **Aucune entrée depuis l’extérieur** : aucune adresse `https` n’ouvre l’application ; le schéma interne `diaspay://` n’accepte que `tranche/<identifiant>` (jamais une référence) et ignore toute autre adresse.
- **Contrôle côté serveur à chaque ouverture** : session, qualité de partie, jeton actif ; tout ce qui est affiché est relu sur le serveur.
- **Réponse indistincte** pour une référence inconnue ou étrangère, limitation des échecs, événement suspect au-delà du seuil.
- **Capture d’écran bloquée** sur les écrans sensibles de l’appareil du payeur.
- **Confirmation explicite** du montant et du bénéficiaire avant toute autorisation \[Cahier §5.2\].

### État au 17 novembre 2026

Le serveur est prêt : jeton, contrôles, quatre actions, devis et frais, journalisation. **L’espace de vérification lui-même n’a pas encore d’écran** : il sera conçu, maquetté et soumis au Dr au lot Y, avant tout développement.

## Cycle de vie, de la soumission au paiement

**Le TrustToken existe dès la soumission, et rien de ce qui part vers le payeur hors de l’application ne permet d’ouvrir la demande.** Le seul chemin passe par la connexion et par les contrôles du serveur.

&#91;embedded content: de la soumission au paiement · 4 acteurs, 10 étapes\]

Demander des informations, contester ou rejeter empruntent le même chemin jusqu’à la décision du payeur. En mode conditionnel, seule l’issue change : les fonds restent chez le partenaire habilité, et le jeton sert à la confirmation, avec une durée qui court depuis le paiement.

## Exigence 5.1, point par point

**Cinq points sur neuf sont couverts, trois le sont en partie, un est absent : la signature cryptographique, dont dépendent aussi le rejeu et l’intégrité, attend le TrustEngine de la phase 2.** « Couvert » signifie en place et testé sur le projet de développement ; aucun test n’a encore été fait sur téléphone.

| Point du cahier §5.1 | État | Ce qui est en place | Ce qui manque |
| --- | --- | --- | --- |
| Liens authentifiés et signés cryptographiquement | Absent | Signature simulée | Signature réelle et publication des clés publiques (TrustEngine) |
| Durée de validité contrôlée | Couvert | Validité liée au cycle de vie de la demande ; durée de confirmation après paiement en mode conditionnel | Durée d’expiration des demandes à fixer (paramètre ouvert) |
| Révocation possible | Couvert | Révocation manuelle motivée, automatique aux statuts finaux et à l’annulation de l’opération ; réémission | Écrans de révocation (lot Y) |
| Protection contre le rejeu | Partiel | Jeton à usage unique pour la confirmation, référence aléatoire de 72 bits, verrou à la confirmation, capture d’écran bloquée | Sans signature, une référence photographiée depuis un autre appareil reste exploitable par une partie au dossier jusqu’à son usage ou sa révocation |
| Protection contre la substitution de destinataire | Couvert | Résolution réservée aux parties ; numéro de téléphone et, dès N1, nom figés ; prise en charge d’un payeur invité limitée au titulaire du numéro | — |
| Intégrité des paramètres | Partiel | Montant, bénéficiaire et état relus sur le serveur à chaque ouverture | Authentification cryptographique de la référence (TrustEngine) |
| Authentification avant toute action sensible | Partiel | Session obligatoire pour toute fonction ; aucun droit pour un visiteur non connecté ; biométrie de l’appareil | Authentification multifacteur selon le risque \[Cahier §5.2\], seuils à définir |
| Protection contre l’hameçonnage | Couvert | Aucun lien à imiter ; messages externes fixes rappelant que DiasPay n’envoie jamais de lien | Domaine d’envoi authentifié et expéditeur SMS déclaré, avec les canaux réels |
| Protection contre les redirections | Couvert | Aucune adresse externe n’ouvre l’application ; schéma interne restreint | — |

## Phase 1 aujourd’hui, TrustEngine demain

**En phase 1, la confiance repose sur le serveur DiasPay (Supabase) : c’est lui qui émet, garde, contrôle et révoque les jetons. En phase 2, le TrustEngine signera chaque jeton, ce qui permettra de prouver son origine même hors du serveur.**

| Sujet | Phase 1 (en place) | Phase 2 (TrustEngine) |
| --- | --- | --- |
| Émission | Serveur, à la soumission | TrustEngine, sur ordre du serveur |
| Signature | Simulée (`SIMULATED`) | Signature réelle ; l’algorithme envisagé est Ed25519, à confirmer |
| Clés | Aucune clé réelle | Clés de signature gérées hors de la base, rotation, publication des clés publiques |
| Vérification | Relecture sur le serveur à chaque ouverture | Relecture sur le serveur + vérification de la signature, y compris hors ligne par l’application d’un prestataire |
| Rejeu et intégrité | Couverts en partie (voir 5.1) | Couverts entièrement |
| Format du QR de confirmation (mode conditionnel) | `DPQ1:<référence>:<identifiant de clé>:<signature>`, image désactivée par défaut | Même format, signature réelle |

Le passage d’une phase à l’autre ne change rien pour l’utilisateur : les écrans, les règles et les codes restent les mêmes, seule la preuve d’origine devient cryptographique. Le TrustEngine n’est pas démarré ; son calendrier dépend de l’arrimage à TrustPayWay.

## À ne pas confondre : le QR de présentation PAYQR

**Le QR affiché par un commerçant en magasin n’est ni un TrustToken ni un DiasPay Link : c’est une brique de PAYQR, qui sert seulement à relier une demande à la bonne personne en présentiel.** Le dossier institutionnel décrit PAYQR comme un QR dynamique intégrant le montant, rattaché à un marchand vérifié \[Institutionnel, PAYQR\].

|  | TrustToken + DiasPay Link | QR de présentation PAYQR |
| --- | --- | --- |
| Usage | Toute demande, surtout à distance | Paiement en présence d’un commerçant |
| Forme | Aucune image, aucune adresse | QR affiché sur l’écran du commerçant, renouvelé en continu |
| Durée | Liée à la demande | Courte (valeur à fixer avec le partenaire) |
| Effet | Ouvre l’espace de vérification | Relie la demande au client qui scanne ; **n’autorise aucun paiement** |
| Après le scan | — | Le client voit le nom du commerçant et le montant dans DiasPay, puis décide comme pour toute demande |
| Garde-fou | Résolution réservée aux parties | Usage unique ; si un payeur a été invité par téléphone, seul le titulaire de ce numéro peut prendre la demande |
| État | Serveur en place | Serveur en place, sans écran ; périmètre commerçant de la phase 1 à valider (proposition K8) |

## À valider par le Dr et paramètres ouverts

**Trois choix de notre part demandent l’accord du Dr ; quatre valeurs restent à fixer avant la production.** Aucune valeur n’a été inventée : sans elles, les réglages sûrs s’appliquent.

### Choix à valider

- [ ] **Validité liée à la demande** : jusqu’au paiement, le TrustToken vit aussi longtemps que la demande, sans durée propre. Alternative : une durée fixe par jeton, avec réémission. Notre recommandation : garder le lien avec la demande, plus simple pour le payeur.
- [ ] **Qui peut résoudre une référence** : le payeur et l’initiateur, et le prestataire en mode conditionnel seulement. Faut-il l’ouvrir à un témoin désigné, pour qu’il retrouve la demande à confirmer ?
- [ ] **Nom figé à partir du niveau N1** : un demandeur vérifié ne peut plus changer son nom sans nouvelle vérification d’identité. Le Dr confirme-t-il cette règle ?

### Valeurs à fixer

| Paramètre | Qui la fournit | Effet tant qu’elle manque |
| --- | --- | --- |
| Durée d’expiration d’une demande, par type de besoin | Client | Demandes sans échéance ; le jeton suit leur cycle de vie |
| Durée de confirmation après paiement (mode conditionnel) | Client, partenaire | 7 jours en développement seulement |
| Durée de vie du QR de présentation PAYQR | Partenaire, essais | Pas de mise en service du présentiel |
| Seuils de l’authentification multifacteur selon le risque | Client, partenaire | Biométrie de l’appareil seule |

### Sources

Cahier d’extension fonctionnelle de DiasPayQR (§1, §3.B à §3.D, §5.1, §5.2, §6, §7, cas 8, 13, 25) · Message du Dr préparant le kickoff (cas 1 et 2) · Dossier institutionnel Diaspora Business Hub 237 (DiasPayQR, PAYQR, DiasPay) · Dépôt DiasPay, `docs/decisions.md` (décisions Xc-2 à Xc-9) et `docs/specs/trustlink-security.md`.
