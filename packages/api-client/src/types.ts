import type { Money, ReleaseMode, TrancheStatus, TxStatus, Vertical } from '@diaspay/domain';

export interface Tranche {
  id: string;
  seq: number;
  label: string;
  amountMinor: number;
  dueDate?: string;
  status: TrancheStatus;
  releaseMode: ReleaseMode;
  contestHours: number;
  contestEndsAt?: string; // ISO
  reference?: string;     // référence courte portée par l'eQR
  evidenceCount: number;
  releasedAt?: string;
}

export interface Transaction {
  id: string;
  vertical: Vertical;
  purpose: string;
  amount: Money;
  status: TxStatus;
  providerName: string;
  beneficiaryName: string;
  tranches: Tranche[];
  createdAt: string;
}

/** Profil de démonstration : le payeur (diaspora) ou le prestataire. */
export type Persona = 'PAYER' | 'PROVIDER';

export interface AuditEntry {
  at: string;
  event: string;
  trancheId?: string;
  detail?: string;
}

/** Contrat unique entre les apps et le serveur. Le mock puis le TrustEngine l'implémentent. */
export interface TransactionApi {
  listTransactions(): Promise<Transaction[]>;
  getTransaction(id: string): Promise<Transaction>;
  payTranche(trancheId: string): Promise<Transaction>;                    // simulé
  confirmByReference(reference: string): Promise<Transaction>;            // prestataire (scan eQR)
  approveRelease(trancheId: string): Promise<Transaction>;                // payeur, déblocage anticipé
  openDispute(trancheId: string, reason: string): Promise<Transaction>;
  timeline(txId: string): Promise<AuditEntry[]>;
}
