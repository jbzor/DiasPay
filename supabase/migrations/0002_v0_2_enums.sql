-- v0.2 partie A : valeurs d'enum (migration séparée : PostgreSQL interdit d'utiliser
-- une valeur d'enum ajoutée dans la même transaction).
-- =====================  PARTIE A  =====================================
alter type vertical  add value if not exists 'RENT';
alter type vertical  add value if not exists 'AGRO';
alter type vertical  add value if not exists 'REAL_ESTATE';
alter type vertical  add value if not exists 'LAND';
alter type tx_status add value if not exists 'IN_PROGRESS';

