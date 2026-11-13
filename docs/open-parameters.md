# Paramètres ouverts (à ne pas inventer)

Les valeurs ci-dessous ne sont pas fournies par le client, le partenaire de paiement ou le conseil juridique. Elles existent comme **réglages sans valeur par défaut inventée** : tant qu’un réglage manque, la fonction concernée refuse par prudence, ou bien la fonctionnalité reste inactive. Une valeur de développement, quand il y en a une, est posée seulement si `mock_mode = 'true'` et marquée comme telle. Source : `docs/specs/modele-cible-v2.md`, section 6.

| # | Paramètre | Où | Sans valeur | Valeur de développement | À fournir par |
|---|---|---|---|---|---|
| 1 | Plafonds par niveau d’enrôlement (par opération, jour, mois) | `enrolment_limits` (lot X v2, X4, passe 2) | refus explicite à l’acceptation | — | client, partenaire, conseil juridique |
| 2 | Durée de vie du jeton de présentation (QR du commerçant) et fréquence de rotation | `app_config.presentation_token_ttl_seconds` | `issue_presentation_token` répond `NOT_CONFIGURED` | `90` (mock_mode, posé par 0016) | partenaire, essais |
| 3 | Durée d’expiration d’une demande soumise, par type de besoin | `request_modules.request_expiry_days` | aucune expiration (`expires_at` vide) | — | client |
| 4 | Seuil du mode `RISK_BASED` (montant, par devise) | `app_config.risk_review_threshold` (JSON, par exemple `{"XAF": 1000000}`) | revue par le bureau (`THRESHOLD_NOT_CONFIGURED`) | — | bureau de contrôle |
| 5 | Rétrofacturation : délais et recours selon le rail (carte, mobile money) | conditions générales ; plan de comptes (`docs/specs/ledger.md`) | remboursement manuel par un administrateur seulement | — | partenaire, conseil juridique |
| 6 | Durées de conservation des données (santé en particulier) | `request_modules` (X6, passe 2) | conservation sans purge automatique | — | atelier juridique |
| 7 | Disponibilité des cotations de change auprès du partenaire | `fx_quotes` (X5, passe 2) | cotation simulée marquée `simulated` | — | partenaire |

## Décisions de configuration également en attente

| Réglage | Valeur actuelle | Remarque |
|---|---|---|
| `eqr_image_enabled` | `false` | QR retiré du parcours par défaut (DIRECT) ; à décider pour CONDITIONAL |
| `request_modules.platform_review` | `NEVER` partout (K2) | `ALWAYS` ou `RISK_BASED` par module, si le bureau le demande |
| `request_modules.settlement_mode` | DIRECT (vague 1), CONDITIONAL (vague 2) | séquestre en phases 2 et 3 (K1) |
| `app_config.payment_provider` | `SIMULATED` | TrustPayWay quand l’adaptateur réel existera |
