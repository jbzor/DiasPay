# Paramètres ouverts (à ne pas inventer)

Les valeurs ci-dessous ne sont pas fournies par le client, le partenaire de paiement ou le conseil juridique. Elles existent comme **réglages sans valeur par défaut inventée** : tant qu’un réglage manque, la fonction concernée refuse par prudence, ou bien la fonctionnalité reste inactive. Une valeur de développement, quand il y en a une, est posée seulement si `mock_mode = 'true'` et marquée comme telle. Source : `docs/specs/modele-cible-v2.md`, section 6.

| # | Paramètre | Où | Sans valeur | Valeur de développement | À fournir par |
|---|---|---|---|---|---|
| 1 | Plafonds par niveau d’enrôlement et devise (par paiement, jour, mois), et période (civile UTC aujourd’hui, ou glissante) | `enrolment_limits` (0020) ; réglage `limits_when_missing` | `LIMITS_NOT_CONFIGURED` : paiement refusé (REFUSE par défaut) | lignes `dev_only` sans aucun plafond (valeurs nulles), mock_mode seulement | client, partenaire, conseil juridique |
| 2 | Durée de vie du jeton de présentation (QR du commerçant) et fréquence de rotation | `app_config.presentation_token_ttl_seconds` | `issue_presentation_token` répond `NOT_CONFIGURED` | `90` (mock_mode, posé par 0016) | partenaire, essais |
| 3 | Durée d’expiration d’une demande soumise, par type de besoin | `request_modules.request_expiry_days` | aucune expiration (`expires_at` vide) ; en `DIRECT`, le TrustToken de la demande n’expire pas non plus (il en hérite dès qu’une durée est fixée, Xc-7) | — | client |
| 4 | Seuil du mode `RISK_BASED` (montant, par devise) | `app_config.risk_review_threshold` (JSON, par exemple `{"XAF": 1000000}`) | revue par le bureau (`THRESHOLD_NOT_CONFIGURED`) | — | bureau de contrôle |
| 5 | Rétrofacturation : délais et recours selon le rail (carte, mobile money) | conditions générales ; plan de comptes (`docs/specs/ledger.md`) | remboursement manuel par un administrateur seulement | — | partenaire, conseil juridique |
| 6 | Durées de conservation des données (santé en particulier), et pièces d’identité de l’enrôlement | `request_modules.retention_days` (0022) ; `enrolment_documents` (0020) | conservation sans purge automatique (colonne vide) | — | atelier juridique |
| 7 | Disponibilité des cotations de change auprès du partenaire | `fx_quotes` (0021) ; taux du simulateur `simulated_fx_rates` | devise de la demande seulement ; autre devise : `QUOTE_UNAVAILABLE` (aucun taux inventé) | parité fixe EUR/XAF 655,957 seulement, devis marqué `simulated` (mock_mode) | partenaire |
| 8 | Durée de vie d’un devis (« expiration courte ») | `app_config.fx_quote_ttl_seconds` | `get_quote` répond `NOT_CONFIGURED` : aucun paiement | `300` (mock_mode, posé par 0021) | partenaire, essais |
| 9 | Frais : barème par poste (service, change, moyen de paiement), payeur des frais, arrondi | `app_config.fee_schedule` (JSON en points de base : `serviceBps`, `fxBps`, `methodBps` par moyen) | aucun frais | — | client, partenaire |

## Décisions de configuration également en attente

| Réglage | Valeur actuelle | Remarque |
|---|---|---|
| `eqr_image_enabled` | `false` | QR retiré du parcours par défaut (DIRECT) ; à décider pour CONDITIONAL |
| `request_modules.platform_review` | `NEVER` partout (K2) | `ALWAYS` ou `RISK_BASED` par module, si le bureau le demande |
| `request_modules.settlement_mode` | DIRECT (vague 1), CONDITIONAL (vague 2) | séquestre en phases 2 et 3 (K1) |
| `app_config.payment_provider` | `SIMULATED` | TrustPayWay quand l’adaptateur réel existera |
| `app_config.kyc_simulated_result` | `APPROVED` (mock_mode seulement) | résultat de l’adaptateur KYC simulé ; absent en production, où l’adaptateur réel (à choisir) appelle `apply_kyc_result` |
| `app_config.limits_when_missing` | absent (REFUSE) | ALLOW seulement par décision explicite (ligne 1) |
| `app_config.sim_payment_scenario`, `sim_payment_delay_seconds`, `sim_payment_late_seconds` | `SUCCESS`, `5`, `60` (mock_mode seulement, 0033) | simulateur du partenaire côté serveur (lot A, `docs/supabase-setup.md` §10) ; absents en production |
