// Fichier généré par `pnpm db:types` (supabase gen types) : ne pas modifier à la main.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "_release_rules_0003": {
                  Row: {
                    "contest_hours": number,"dual_validation": boolean,"release_mode": Database["public"]['Enums']["release_mode"],"vertical": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contest_hours"?: number,"dual_validation"?: boolean,"release_mode": Database["public"]['Enums']["release_mode"],"vertical": string
                  }
                  Update: {
                    "contest_hours"?: number,"dual_validation"?: boolean,"release_mode"?: Database["public"]['Enums']["release_mode"],"vertical"?: string
                  }
                  Relationships: [
                    
                  ]
                },"_required_documents_0005": {
                  Row: {
                    "kind": string,"required": boolean,"vertical": string
                  }
                  ComputedFields: never
                  Insert: {
                    "kind": string,"required": boolean,"vertical": string
                  }
                  Update: {
                    "kind"?: string,"required"?: boolean,"vertical"?: string
                  }
                  Relationships: [
                    
                  ]
                },"allowed_transitions": {
                  Row: {
                    "from_status": Database["public"]['Enums']["tx_status"],"role": Database["public"]['Enums']["tx_role"],"to_status": Database["public"]['Enums']["tx_status"],"validator_only": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "from_status": Database["public"]['Enums']["tx_status"],"role": Database["public"]['Enums']["tx_role"],"to_status": Database["public"]['Enums']["tx_status"],"validator_only"?: boolean
                  }
                  Update: {
                    "from_status"?: Database["public"]['Enums']["tx_status"],"role"?: Database["public"]['Enums']["tx_role"],"to_status"?: Database["public"]['Enums']["tx_status"],"validator_only"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"app_config": {
                  Row: {
                    "key": string,"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"value": string
                  }
                  Update: {
                    "key"?: string,"value"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"event": string,"from_status": Database["public"]['Enums']["tx_status"] | null,"hash": string,"id": number,"payload": NonNullable<Json>,"prev_hash": string | null,"to_status": Database["public"]['Enums']["tx_status"] | null,"tranche_id": string | null,"tx_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"event": string,"from_status"?: Database["public"]['Enums']["tx_status"] | null,"hash": string,"id"?: never,"payload"?: NonNullable<Json>,"prev_hash"?: string | null,"to_status"?: Database["public"]['Enums']["tx_status"] | null,"tranche_id"?: string | null,"tx_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"event"?: string,"from_status"?: Database["public"]['Enums']["tx_status"] | null,"hash"?: string,"id"?: never,"payload"?: NonNullable<Json>,"prev_hash"?: string | null,"to_status"?: Database["public"]['Enums']["tx_status"] | null,"tranche_id"?: string | null,"tx_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_log_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"disputes": {
                  Row: {
                    "id": string,"opened_at": string,"opened_by": string,"reason": string,"reason_code": string | null,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"responded_at": string | null,"responded_by": string | null,"response": string | null,"status": string,"tranche_id": string,"tx_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"opened_at"?: string,"opened_by": string,"reason": string,"reason_code"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"responded_at"?: string | null,"responded_by"?: string | null,"response"?: string | null,"status"?: string,"tranche_id": string,"tx_id": string
                  }
                  Update: {
                    "id"?: string,"opened_at"?: string,"opened_by"?: string,"reason"?: string,"reason_code"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"responded_at"?: string | null,"responded_by"?: string | null,"response"?: string | null,"status"?: string,"tranche_id"?: string,"tx_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "disputes_opened_by_fkey"
      columns: ["opened_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disputes_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disputes_responded_by_fkey"
      columns: ["responded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disputes_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "disputes_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disputes_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disputes_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "content_hash": string | null,"created_at": string,"deleted_at": string | null,"file_name": string | null,"hash_algo": string | null,"id": string,"kind": string,"mime_type": string,"size_bytes": number,"storage_path": string,"tranche_id": string | null,"tx_id": string,"uploaded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_hash"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"file_name"?: string | null,"hash_algo"?: string | null,"id"?: string,"kind": string,"mime_type": string,"size_bytes": number,"storage_path": string,"tranche_id"?: string | null,"tx_id": string,"uploaded_by": string
                  }
                  Update: {
                    "content_hash"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"file_name"?: string | null,"hash_algo"?: string | null,"id"?: string,"kind"?: string,"mime_type"?: string,"size_bytes"?: number,"storage_path"?: string,"tranche_id"?: string | null,"tx_id"?: string,"uploaded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "documents_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"dual_thresholds": {
                  Row: {
                    "currency": Database["public"]['Enums']["currency"],"threshold_minor": number
                  }
                  ComputedFields: never
                  Insert: {
                    "currency": Database["public"]['Enums']["currency"],"threshold_minor": number
                  }
                  Update: {
                    "currency"?: Database["public"]['Enums']["currency"],"threshold_minor"?: number
                  }
                  Relationships: [
                    
                  ]
                },"ledger_accounts": {
                  Row: {
                    "code": string,"kind": string,"label_en": string,"label_fr": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"kind": string,"label_en": string,"label_fr": string
                  }
                  Update: {
                    "code"?: string,"kind"?: string,"label_en"?: string,"label_fr"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ledger_entries": {
                  Row: {
                    "account_code": string,"created_at": string,"credit_minor": number,"currency": Database["public"]['Enums']["currency"],"debit_minor": number,"id": number,"journal_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_code": string,"created_at"?: string,"credit_minor"?: number,"currency": Database["public"]['Enums']["currency"],"debit_minor"?: number,"id"?: never,"journal_id": string
                  }
                  Update: {
                    "account_code"?: string,"created_at"?: string,"credit_minor"?: number,"currency"?: Database["public"]['Enums']["currency"],"debit_minor"?: number,"id"?: never,"journal_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_entries_account_code_fkey"
      columns: ["account_code"]
isOneToOne: false
      referencedRelation: "ledger_accounts"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "ledger_entries_journal_id_fkey"
      columns: ["journal_id"]
isOneToOne: false
      referencedRelation: "ledger_journals"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_journals": {
                  Row: {
                    "attempt_id": string | null,"created_at": string,"event_id": number | null,"id": string,"kind": string,"memo": string | null,"refund_id": string | null,"reverses_journal_id": string | null,"tranche_id": string,"tx_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_id"?: string | null,"created_at"?: string,"event_id"?: number | null,"id"?: string,"kind": string,"memo"?: string | null,"refund_id"?: string | null,"reverses_journal_id"?: string | null,"tranche_id": string,"tx_id": string
                  }
                  Update: {
                    "attempt_id"?: string | null,"created_at"?: string,"event_id"?: number | null,"id"?: string,"kind"?: string,"memo"?: string | null,"refund_id"?: string | null,"reverses_journal_id"?: string | null,"tranche_id"?: string,"tx_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_journals_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: false
      referencedRelation: "payment_attempts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_journals_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: false
      referencedRelation: "v_reconciliation"
      referencedColumns: ["attempt_id"]
    },{
      foreignKeyName: "ledger_journals_refund_id_fkey"
      columns: ["refund_id"]
isOneToOne: false
      referencedRelation: "refunds"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_journals_reverses_journal_id_fkey"
      columns: ["reverses_journal_id"]
isOneToOne: false
      referencedRelation: "ledger_journals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_journals_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "ledger_journals_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_journals_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_journals_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"event": string,"id": string,"payload": NonNullable<Json>,"read_at": string | null,"tx_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event": string,"id"?: string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"tx_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"event"?: string,"id"?: string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"tx_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_attempts": {
                  Row: {
                    "amount_minor": number,"completed_at": string | null,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency"],"error_code": string | null,"id": string,"idempotency_key": string,"method": string,"provider": string,"provider_ref": string | null,"status": string,"tranche_id": string,"tx_id": string,"updated_at": string,"_attempt_json": Json | null
                  }
                  ComputedFields: "_attempt_json"
                  Insert: {
                    "amount_minor": number,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency": Database["public"]['Enums']["currency"],"error_code"?: string | null,"id"?: string,"idempotency_key": string,"method": string,"provider": string,"provider_ref"?: string | null,"status"?: string,"tranche_id": string,"tx_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_minor"?: number,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency"],"error_code"?: string | null,"id"?: string,"idempotency_key"?: string,"method"?: string,"provider"?: string,"provider_ref"?: string | null,"status"?: string,"tranche_id"?: string,"tx_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_attempts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_attempts_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "payment_attempts_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_attempts_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_attempts_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "created_at": string,"external_id": string | null,"fee_minor": number,"id": string,"provider": string,"status": Database["public"]['Enums']["payment_status"],"tranche_id": string | null,"tx_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"external_id"?: string | null,"fee_minor"?: number,"id"?: string,"provider"?: string,"status"?: Database["public"]['Enums']["payment_status"],"tranche_id"?: string | null,"tx_id": string
                  }
                  Update: {
                    "created_at"?: string,"external_id"?: string | null,"fee_minor"?: number,"id"?: string,"provider"?: string,"status"?: Database["public"]['Enums']["payment_status"],"tranche_id"?: string | null,"tx_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "payments_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "can_initiate_requests": boolean,"country": string | null,"created_at": string,"full_name": string,"id": string,"kyc_status": string,"locale": string,"phone": string | null,"platform_role": Database["public"]['Enums']["platform_role"],"primary_role": string | null,"push_enabled": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "can_initiate_requests"?: boolean,"country"?: string | null,"created_at"?: string,"full_name": string,"id": string,"kyc_status"?: string,"locale"?: string,"phone"?: string | null,"platform_role"?: Database["public"]['Enums']["platform_role"],"primary_role"?: string | null,"push_enabled"?: boolean
                  }
                  Update: {
                    "can_initiate_requests"?: boolean,"country"?: string | null,"created_at"?: string,"full_name"?: string,"id"?: string,"kyc_status"?: string,"locale"?: string,"phone"?: string | null,"platform_role"?: Database["public"]['Enums']["platform_role"],"primary_role"?: string | null,"push_enabled"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"providers": {
                  Row: {
                    "city": string,"created_at": string,"id": string,"name": string,"phone": string | null,"user_id": string | null,"verified": boolean,"verticals": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "city": string,"created_at"?: string,"id"?: string,"name": string,"phone"?: string | null,"user_id"?: string | null,"verified"?: boolean,"verticals"?: (string)[]
                  }
                  Update: {
                    "city"?: string,"created_at"?: string,"id"?: string,"name"?: string,"phone"?: string | null,"user_id"?: string | null,"verified"?: boolean,"verticals"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "providers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"recurrence_plans": {
                  Row: {
                    "frequency": Database["public"]['Enums']["recurrence_freq"],"installments": number,"start_date": string,"tx_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "frequency": Database["public"]['Enums']["recurrence_freq"],"installments": number,"start_date": string,"tx_id": string
                  }
                  Update: {
                    "frequency"?: Database["public"]['Enums']["recurrence_freq"],"installments"?: number,"start_date"?: string,"tx_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recurrence_plans_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: true
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recurrence_plans_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: true
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"refunds": {
                  Row: {
                    "amount_minor": number,"attempt_id": string,"completed_at": string | null,"created_at": string,"currency": Database["public"]['Enums']["currency"],"error_code": string | null,"id": string,"idempotency_key": string,"provider_ref": string | null,"reason": string,"requested_by": string | null,"status": string,"tranche_id": string,"tx_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"attempt_id": string,"completed_at"?: string | null,"created_at"?: string,"currency": Database["public"]['Enums']["currency"],"error_code"?: string | null,"id"?: string,"idempotency_key": string,"provider_ref"?: string | null,"reason": string,"requested_by"?: string | null,"status"?: string,"tranche_id": string,"tx_id": string
                  }
                  Update: {
                    "amount_minor"?: number,"attempt_id"?: string,"completed_at"?: string | null,"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"],"error_code"?: string | null,"id"?: string,"idempotency_key"?: string,"provider_ref"?: string | null,"reason"?: string,"requested_by"?: string | null,"status"?: string,"tranche_id"?: string,"tx_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: false
      referencedRelation: "payment_attempts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: false
      referencedRelation: "v_reconciliation"
      referencedColumns: ["attempt_id"]
    },{
      foreignKeyName: "refunds_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "refunds_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"release_events": {
                  Row: {
                    "created_at": string,"id": string,"tranche_id": string | null,"trigger": string,"tx_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"tranche_id"?: string | null,"trigger": string,"tx_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"tranche_id"?: string | null,"trigger"?: string,"tx_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "release_events_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "release_events_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "release_events_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "release_events_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"request_messages": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"id": string,"kind": string,"tranche_id": string | null,"tx_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body": string,"created_at"?: string,"id"?: string,"kind": string,"tranche_id"?: string | null,"tx_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"tranche_id"?: string | null,"tx_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "request_messages_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "request_messages_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "request_messages_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "request_messages_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "request_messages_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"request_modules": {
                  Row: {
                    "code": string,"contest_hours": number,"created_at": string,"description_en": string | null,"description_fr": string | null,"display_order": number,"dual_validation": boolean,"enabled": boolean,"label_en": string,"label_fr": string,"multiple_payers": boolean,"platform_review": string,"release_mode": Database["public"]['Enums']["release_mode"],"required_documents": NonNullable<Json>,"updated_at": string,"wave": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"contest_hours"?: number,"created_at"?: string,"description_en"?: string | null,"description_fr"?: string | null,"display_order"?: number,"dual_validation"?: boolean,"enabled"?: boolean,"label_en": string,"label_fr": string,"multiple_payers"?: boolean,"platform_review"?: string,"release_mode": Database["public"]['Enums']["release_mode"],"required_documents"?: NonNullable<Json>,"updated_at"?: string,"wave"?: number
                  }
                  Update: {
                    "code"?: string,"contest_hours"?: number,"created_at"?: string,"description_en"?: string | null,"description_fr"?: string | null,"display_order"?: number,"dual_validation"?: boolean,"enabled"?: boolean,"label_en"?: string,"label_fr"?: string,"multiple_payers"?: boolean,"platform_review"?: string,"release_mode"?: Database["public"]['Enums']["release_mode"],"required_documents"?: NonNullable<Json>,"updated_at"?: string,"wave"?: number
                  }
                  Relationships: [
                    
                  ]
                },"security_events": {
                  Row: {
                    "created_at": string,"detail": NonNullable<Json>,"id": number,"kind": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"detail"?: NonNullable<Json>,"id"?: never,"kind": string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"detail"?: NonNullable<Json>,"id"?: never,"kind"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "security_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"signing_keys": {
                  Row: {
                    "active": boolean,"created_at": string,"kid": string,"public_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"kid": string,"public_key": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"kid"?: string,"public_key"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tranche_tokens": {
                  Row: {
                    "created_at": string,"expires_at": string,"id": string,"kid": string,"reference": string,"revoke_reason": string | null,"revoked_at": string | null,"revoked_by": string | null,"signature": string,"simulated": boolean,"tranche_id": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"id"?: string,"kid": string,"reference"?: string,"revoke_reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"signature": string,"simulated"?: boolean,"tranche_id": string,"used_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"id"?: string,"kid"?: string,"reference"?: string,"revoke_reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"signature"?: string,"simulated"?: boolean,"tranche_id"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tranche_tokens_kid_fkey"
      columns: ["kid"]
isOneToOne: false
      referencedRelation: "signing_keys"
      referencedColumns: ["kid"]
    },{
      foreignKeyName: "tranche_tokens_revoked_by_fkey"
      columns: ["revoked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tranche_tokens_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "tranche_tokens_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    }
                  ]
                },"tranche_transitions": {
                  Row: {
                    "from_status": Database["public"]['Enums']["tranche_status"],"role": Database["public"]['Enums']["tx_role"],"to_status": Database["public"]['Enums']["tranche_status"],"validator_only": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "from_status": Database["public"]['Enums']["tranche_status"],"role": Database["public"]['Enums']["tx_role"],"to_status": Database["public"]['Enums']["tranche_status"],"validator_only"?: boolean
                  }
                  Update: {
                    "from_status"?: Database["public"]['Enums']["tranche_status"],"role"?: Database["public"]['Enums']["tx_role"],"to_status"?: Database["public"]['Enums']["tranche_status"],"validator_only"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"tranches": {
                  Row: {
                    "amount_minor": number,"contest_ends_at": string | null,"contest_hours": number,"created_at": string,"due_date": string | null,"first_viewed_at": string | null,"id": string,"label": string,"release_mode": Database["public"]['Enums']["release_mode"],"released_at": string | null,"seq": number,"status": Database["public"]['Enums']["tranche_status"],"tx_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"contest_ends_at"?: string | null,"contest_hours"?: number,"created_at"?: string,"due_date"?: string | null,"first_viewed_at"?: string | null,"id"?: string,"label": string,"release_mode": Database["public"]['Enums']["release_mode"],"released_at"?: string | null,"seq": number,"status"?: Database["public"]['Enums']["tranche_status"],"tx_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_minor"?: number,"contest_ends_at"?: string | null,"contest_hours"?: number,"created_at"?: string,"due_date"?: string | null,"first_viewed_at"?: string | null,"id"?: string,"label"?: string,"release_mode"?: Database["public"]['Enums']["release_mode"],"released_at"?: string | null,"seq"?: number,"status"?: Database["public"]['Enums']["tranche_status"],"tx_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tranches_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tranches_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"transaction_parties": {
                  Row: {
                    "id": string,"invited_phone": string | null,"role": Database["public"]['Enums']["tx_role"],"tx_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"invited_phone"?: string | null,"role": Database["public"]['Enums']["tx_role"],"tx_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "id"?: string,"invited_phone"?: string | null,"role"?: Database["public"]['Enums']["tx_role"],"tx_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "transaction_parties_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transaction_parties_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transaction_parties_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"transactions": {
                  Row: {
                    "amount_minor": number | null,"beneficiary_name": string | null,"created_at": string,"created_by": string,"currency": Database["public"]['Enums']["currency"] | null,"draft_data": NonNullable<Json>,"due_date": string | null,"expires_at": string | null,"id": string,"plan_type": string | null,"provider_id": string | null,"provider_name": string | null,"purpose": string | null,"reject_reason": string | null,"status": Database["public"]['Enums']["tx_status"],"updated_at": string,"vertical": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor"?: number | null,"beneficiary_name"?: string | null,"created_at"?: string,"created_by": string,"currency"?: Database["public"]['Enums']["currency"] | null,"draft_data"?: NonNullable<Json>,"due_date"?: string | null,"expires_at"?: string | null,"id"?: string,"plan_type"?: string | null,"provider_id"?: string | null,"provider_name"?: string | null,"purpose"?: string | null,"reject_reason"?: string | null,"status"?: Database["public"]['Enums']["tx_status"],"updated_at"?: string,"vertical": string
                  }
                  Update: {
                    "amount_minor"?: number | null,"beneficiary_name"?: string | null,"created_at"?: string,"created_by"?: string,"currency"?: Database["public"]['Enums']["currency"] | null,"draft_data"?: NonNullable<Json>,"due_date"?: string | null,"expires_at"?: string | null,"id"?: string,"plan_type"?: string | null,"provider_id"?: string | null,"provider_name"?: string | null,"purpose"?: string | null,"reject_reason"?: string | null,"status"?: Database["public"]['Enums']["tx_status"],"updated_at"?: string,"vertical"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transactions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transactions_provider_id_fkey"
      columns: ["provider_id"]
isOneToOne: false
      referencedRelation: "providers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "release_rules"
      referencedColumns: ["vertical"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "request_modules"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "required_documents"
      referencedColumns: ["vertical"]
    }
                  ]
                },"trust_tokens": {
                  Row: {
                    "created_at": string,"expires_at": string,"reference": string,"signature": string,"simulated": boolean,"tx_id": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"reference"?: string,"signature": string,"simulated"?: boolean,"tx_id": string,"used_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"reference"?: string,"signature"?: string,"simulated"?: boolean,"tx_id"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "trust_tokens_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: true
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trust_tokens_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: true
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"validations": {
                  Row: {
                    "amount_checked": boolean,"approved": boolean,"decided_at": string,"id": string,"reason": string | null,"tranche_id": string | null,"tx_id": string,"validator_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_checked"?: boolean,"approved": boolean,"decided_at"?: string,"id"?: string,"reason"?: string | null,"tranche_id"?: string | null,"tx_id": string,"validator_id": string
                  }
                  Update: {
                    "amount_checked"?: boolean,"approved"?: boolean,"decided_at"?: string,"id"?: string,"reason"?: string | null,"tranche_id"?: string | null,"tx_id"?: string,"validator_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "validations_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "validations_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "validations_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "validations_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "validations_validator_id_fkey"
      columns: ["validator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"webhook_events": {
                  Row: {
                    "attempt_id": string | null,"error": string | null,"event_id": string,"id": number,"payload": NonNullable<Json>,"processed_at": string | null,"provider": string,"received_at": string,"refund_id": string | null,"result": string | null,"signature_valid": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_id"?: string | null,"error"?: string | null,"event_id": string,"id"?: never,"payload": NonNullable<Json>,"processed_at"?: string | null,"provider": string,"received_at"?: string,"refund_id"?: string | null,"result"?: string | null,"signature_valid": boolean
                  }
                  Update: {
                    "attempt_id"?: string | null,"error"?: string | null,"event_id"?: string,"id"?: never,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"provider"?: string,"received_at"?: string,"refund_id"?: string | null,"result"?: string | null,"signature_valid"?: boolean
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "bo_disputes": {
                  Row: {
                    "amount_minor": number | null,"currency": string | null,"description": string | null,"id": string | null,"is_party": boolean | null,"notified_at": string | null,"opened_at": string | null,"opened_by_role": string | null,"payer_name": string | null,"provider_name": string | null,"purpose": string | null,"reason_code": string | null,"reference": string | null,"resolution_note": string | null,"resolved_at": string | null,"resolved_by_name": string | null,"responded_at": string | null,"response": string | null,"status": string | null,"tranche_id": string | null,"tranche_label": string | null,"tranche_seq": number | null,"tranche_status": string | null,"tx_id": string | null,"vertical": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "disputes_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "disputes_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disputes_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disputes_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "release_rules"
      referencedColumns: ["vertical"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "request_modules"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "required_documents"
      referencedColumns: ["vertical"]
    }
                  ]
                },"bo_dossiers": {
                  Row: {
                    "amount_minor": number | null,"beneficiary_name": string | null,"created_at": string | null,"currency": string | null,"decided_by_me": boolean | null,"id": string | null,"is_party": boolean | null,"payer_name": string | null,"provider_name": string | null,"purpose": string | null,"reference": string | null,"requester_name": string | null,"status": string | null,"submitted_at": string | null,"updated_at": string | null,"validations_received": number | null,"validations_required": number | null,"vertical": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "release_rules"
      referencedColumns: ["vertical"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "request_modules"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "required_documents"
      referencedColumns: ["vertical"]
    }
                  ]
                },"bo_evidence_queue": {
                  Row: {
                    "amount_minor": number | null,"currency": string | null,"decided_by_me": boolean | null,"is_party": boolean | null,"label": string | null,"provider_name": string | null,"purpose": string | null,"reference": string | null,"seq": number | null,"submitted_at": string | null,"tranche_id": string | null,"tx_id": string | null,"validations_received": number | null,"validations_required": number | null,"vertical": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "tranches_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tranches_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "release_rules"
      referencedColumns: ["vertical"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "request_modules"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "transactions_vertical_module_fk"
      columns: ["vertical"]
isOneToOne: false
      referencedRelation: "required_documents"
      referencedColumns: ["vertical"]
    }
                  ]
                },"release_rules": {
                  Row: {
                    "contest_hours": number | null,"dual_validation": boolean | null,"release_mode": Database["public"]['Enums']["release_mode"] | null,"vertical": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "contest_hours"?: number | null,"dual_validation"?: boolean | null,"release_mode"?: Database["public"]['Enums']["release_mode"] | null,"vertical"?: string | null
                         }
                        Update: {
                           "contest_hours"?: number | null,"dual_validation"?: boolean | null,"release_mode"?: Database["public"]['Enums']["release_mode"] | null,"vertical"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"required_documents": {
                  Row: {
                    "kind": string | null,"required": boolean | null,"vertical": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_reconciliation": {
                  Row: {
                    "amount_minor": number | null,"attempt_id": string | null,"attempt_status": string | null,"currency": string | null,"issues": (string)[] | null,"paid_ledger": number | null,"provider": string | null,"reference": string | null,"refunded_requested": number | null,"refunded_settled": number | null,"rejected_events": number | null,"released_ledger": number | null,"success_events": number | null,"tranche_id": string | null,"tranche_status": string | null,"tx_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "payment_attempts_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "bo_evidence_queue"
      referencedColumns: ["tranche_id"]
    },{
      foreignKeyName: "payment_attempts_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_attempts_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "bo_dossiers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_attempts_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "_attempt_json":
{ Args: { "a": Omit<Database["public"]['Tables']["payment_attempts"]['Row'], Database["public"]['Tables']["payment_attempts"]['ComputedFields']> }; Returns: Json
                           },
"_check_message":
{ Args: { "p_text": string }; Returns: string
                           },
"_check_token_manager":
{ Args: { "p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"_dispute_notified_at":
{ Args: { "p_dispute": string }; Returns: string
                           },
"_draft_json":
{ Args: { "p_tx": string }; Returns: Json
                           },
"_duplicate_refs":
{ Args: { "p_tx": string }; Returns: (string)[]
                           },
"_err":
{ Args: { "p_code": string,"p_detail"?: string,"p_message": string }; Returns: undefined
                           },
"_evidence_round_start":
{ Args: { "p_tranche": string }; Returns: string
                           },
"_fold":
{ Args: { "p": string }; Returns: string
                           },
"_hash_reuse":
{ Args: { "p_hash": string,"p_tx": string }; Returns: (string)[]
                           },
"_issue_tranche_token":
{ Args: { "p_tranche": string }; Returns: undefined
                           },
"_mock_mode":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"_norm_hash":
{ Args: { "p": string }; Returns: string
                           },
"_norm_phone":
{ Args: { "p": string }; Returns: string
                           },
"_party_name":
{ Args: { "p_role": Database["public"]['Enums']["tx_role"],"p_tx": string }; Returns: string
                           },
"_party_token":
{ Args: { "p_ref": string }; Returns: {
              "created_at": string,
"expires_at": string,
"id": string,
"kid": string,
"reference": string,
"revoke_reason": string | null,
"revoked_at": string | null,
"revoked_by": string | null,
"signature": string,
"simulated": boolean,
"tranche_id": string,
"used_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "tranche_tokens"
        isOneToOne: true
        isSetofReturn: false
      } },
"_platform_review":
{ Args: { "p_tx": string }; Returns: Json
                           },
"_post_journal":
{ Args: { "p_attempt"?: string,"p_currency": Database["public"]['Enums']["currency"],"p_event"?: number,"p_kind": string,"p_lines": Json,"p_memo"?: string,"p_refund"?: string,"p_reverses"?: string,"p_tranche": string }; Returns: string
                           },
"_process_payment_event":
{ Args: { "p_event": number }; Returns: Json
                           },
"_recently_opened":
{ Args: { "p_path": string }; Returns: boolean
                           },
"_reference_failed":
{ Args: { "p_ref": string,"p_via": string }; Returns: undefined
                           },
"_reference_failures":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"_reference_guard":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"_refunded":
{ Args: { "p_attempt": string }; Returns: number
                           },
"_request_tranche":
{ Args: { "p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"_require_user":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"_require_validator":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"_resolve_dispute_core":
{ Args: { "p_actor": string,"p_dispute": string,"p_note": string,"p_outcome": string }; Returns: {
              "id": string,
"opened_at": string,
"opened_by": string,
"reason": string,
"reason_code": string | null,
"resolution_note": string | null,
"resolved_at": string | null,
"resolved_by": string | null,
"responded_at": string | null,
"responded_by": string | null,
"response": string | null,
"status": string,
"tranche_id": string,
"tx_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "disputes"
        isOneToOne: true
        isSetofReturn: false
      } },
"_revoke_active_token":
{ Args: { "p_actor": string,"p_reason": string,"p_tranche": string }; Returns: string
                           },
"_round_start":
{ Args: { "p_tx": string }; Returns: string
                           },
"_set_tranche_status":
{ Args: { "p_actor": string,"p_event": string,"p_payload"?: Json,"p_to": Database["public"]['Enums']["tranche_status"],"p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"_simulate_token_issue":
{ Args: { "p_tx": string }; Returns: undefined
                           },
"_staff_aal_ok":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"_staff_name":
{ Args: { "p_user": string }; Returns: string
                           },
"_storage_tx":
{ Args: { "p_name": string }; Returns: string
                           },
"_tx_ref":
{ Args: { "p_tx": string }; Returns: string
                           },
"_user_by_phone":
{ Args: { "p_phone": string }; Returns: string
                           },
"_valid_phone":
{ Args: { "p": string }; Returns: boolean
                           },
"activate_due_tranches":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"add_document":
{ Args: { "p_hash"?: string,"p_kind": string,"p_mime": string,"p_name": string,"p_path": string,"p_size": number,"p_tx": string }; Returns: Json
                           },
"answer_info":
{ Args: { "p_message": string,"p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"apply_payment_event":
{ Args: { "p_event_id": string,"p_payload": Json,"p_provider": string,"p_signature_valid": boolean }; Returns: Json
                           },
"bo_audit":
{ Args: { "p_tx": string }; Returns: {
              "actor_id": string,"actor_name": string,"actor_role": string,"created_at": string,"event": string,"from_status": string,"hash": string,"id": number,"payload": Json,"prev_hash": string,"to_status": string,"tranche_id": string,"tranche_seq": number
            }[]
                           },
"bo_audit_verify":
{ Args: { "p_tx": string }; Returns: Json
                           },
"bo_decisions":
{ Args: { "p_tranche"?: string,"p_tx": string }; Returns: {
              "amount_checked": boolean,"approved": boolean,"decided_at": string,"is_me": boolean,"reason": string,"validator_id": string,"validator_name": string
            }[]
                           },
"bo_find_transactions":
{ Args: { "p_query": string }; Returns: {
              "amount_minor": number,"created_at": string,"currency": string,"id": string,"payer_name": string,"provider_name": string,"purpose": string,"reference": string,"status": string,"vertical": string
            }[]
                           },
"claim_dossier":
{ Args: { "p_tx": string }; Returns: {
              "amount_minor": number | null,
"beneficiary_name": string | null,
"created_at": string,
"created_by": string,
"currency": Database["public"]['Enums']["currency"] | null,
"draft_data": NonNullable<Json>,
"due_date": string | null,
"expires_at": string | null,
"id": string,
"plan_type": string | null,
"provider_id": string | null,
"provider_name": string | null,
"purpose": string | null,
"reject_reason": string | null,
"status": Database["public"]['Enums']["tx_status"],
"updated_at": string,
"vertical": string
            }
                          SetofOptions: {
        from: "*"
        to: "transactions"
        isOneToOne: true
        isSetofReturn: false
      } },
"confirm_by_reference":
{ Args: { "p_device_time"?: string,"p_ref": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_tranches":
{ Args: { "p_items": Json,"p_tx": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: false
        isSetofReturn: true
      } },
"decide_tranche":
{ Args: { "p_approved": boolean,"p_reason"?: string,"p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"decide_tx":
{ Args: { "p_amount_checked": boolean,"p_approved": boolean,"p_reason"?: string,"p_tx": string }; Returns: {
              "amount_minor": number | null,
"beneficiary_name": string | null,
"created_at": string,
"created_by": string,
"currency": Database["public"]['Enums']["currency"] | null,
"draft_data": NonNullable<Json>,
"due_date": string | null,
"expires_at": string | null,
"id": string,
"plan_type": string | null,
"provider_id": string | null,
"provider_name": string | null,
"purpose": string | null,
"reject_reason": string | null,
"status": Database["public"]['Enums']["tx_status"],
"updated_at": string,
"vertical": string
            }
                          SetofOptions: {
        from: "*"
        to: "transactions"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_draft":
{ Args: { "p_tx": string }; Returns: undefined
                           },
"demo_reset":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"demo_resolve_dispute":
{ Args: { "p_note": string,"p_outcome": string,"p_tranche": string }; Returns: {
              "id": string,
"opened_at": string,
"opened_by": string,
"reason": string,
"reason_code": string | null,
"resolution_note": string | null,
"resolved_at": string | null,
"resolved_by": string | null,
"responded_at": string | null,
"responded_by": string | null,
"response": string | null,
"status": string,
"tranche_id": string,
"tx_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "disputes"
        isOneToOne: true
        isSetofReturn: false
      } },
"demo_review":
{ Args: { "p_approved": boolean,"p_reason"?: string,"p_tx": string }; Returns: {
              "amount_minor": number | null,
"beneficiary_name": string | null,
"created_at": string,
"created_by": string,
"currency": Database["public"]['Enums']["currency"] | null,
"draft_data": NonNullable<Json>,
"due_date": string | null,
"expires_at": string | null,
"id": string,
"plan_type": string | null,
"provider_id": string | null,
"provider_name": string | null,
"purpose": string | null,
"reject_reason": string | null,
"status": Database["public"]['Enums']["tx_status"],
"updated_at": string,
"vertical": string
            }
                          SetofOptions: {
        from: "*"
        to: "transactions"
        isOneToOne: true
        isSetofReturn: false
      } },
"demo_settle_payment":
{ Args: { "p_attempt": string,"p_outcome"?: string }; Returns: Json
                           },
"demo_settle_refund":
{ Args: { "p_outcome"?: string,"p_refund": string }; Returns: Json
                           },
"document_reuse":
{ Args: { "p_hash": string,"p_tx"?: string }; Returns: Json
                           },
"dossier_checks":
{ Args: { "p_tx": string }; Returns: {
              "code": string,"detail": Json,"result": string
            }[]
                           },
"dossier_documents":
{ Args: { "p_tx": string }; Returns: Json
                           },
"evidence_checks":
{ Args: { "p_tranche": string }; Returns: {
              "code": string,"detail": Json,"result": string
            }[]
                           },
"generate_recurring_tranches":
{ Args: { "p_freq": Database["public"]['Enums']["recurrence_freq"],"p_label"?: string,"p_n": number,"p_start": string,"p_tx": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: false
        isSetofReturn: true
      } },
"get_dispute":
{ Args: { "p_tranche": string }; Returns: Json
                           },
"get_document_access":
{ Args: { "p_document": string }; Returns: Json
                           },
"get_draft":
{ Args: { "p_tx": string }; Returns: Json
                           },
"get_drafts":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_receipt":
{ Args: { "p_tranche": string }; Returns: Json
                           },
"has_audit":
{ Args: { "p_tx": string }; Returns: boolean
                           },
"has_role":
{ Args: { "p_role": Database["public"]['Enums']["tx_role"],"p_tx": string }; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_party":
{ Args: { "p_tx": string }; Returns: boolean
                           },
"is_validator":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"log_audit_export":
{ Args: { "p_rows": number,"p_tx": string }; Returns: undefined
                           },
"mark_received":
{ Args: { "p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"needs_platform_review":
{ Args: { "p_tx": string }; Returns: boolean
                           },
"open_dispute":
{ Args: { "p_reason": string,"p_reason_code"?: string,"p_tranche": string }; Returns: {
              "id": string,
"opened_at": string,
"opened_by": string,
"reason": string,
"reason_code": string | null,
"resolution_note": string | null,
"resolved_at": string | null,
"resolved_by": string | null,
"responded_at": string | null,
"responded_by": string | null,
"response": string | null,
"status": string,
"tranche_id": string,
"tx_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "disputes"
        isOneToOne: true
        isSetofReturn: false
      } },
"open_document":
{ Args: { "p_doc": string }; Returns: Json
                           },
"reissue_token":
{ Args: { "p_reason"?: string,"p_tranche": string }; Returns: Json
                           },
"reject_request":
{ Args: { "p_reason": string,"p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"release_due_tranches":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"remove_document":
{ Args: { "p_doc": string }; Returns: string
                           },
"request_info":
{ Args: { "p_message": string,"p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"request_refund":
{ Args: { "p_amount_minor": number,"p_idempotency_key": string,"p_reason": string,"p_tranche": string }; Returns: Json
                           },
"required_validations":
{ Args: { "p_tranche"?: string,"p_tx": string }; Returns: number
                           },
"resolve_dispute":
{ Args: { "p_dispute": string,"p_note": string,"p_outcome": string }; Returns: {
              "id": string,
"opened_at": string,
"opened_by": string,
"reason": string,
"reason_code": string | null,
"resolution_note": string | null,
"resolved_at": string | null,
"resolved_by": string | null,
"responded_at": string | null,
"responded_by": string | null,
"response": string | null,
"status": string,
"tranche_id": string,
"tx_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "disputes"
        isOneToOne: true
        isSetofReturn: false
      } },
"resolve_reference":
{ Args: { "p_ref": string }; Returns: {
              "expires_at": string,"status": Database["public"]['Enums']["tx_status"],"tx_id": string,"used": boolean
            }[]
                           },
"resolve_reference_info":
{ Args: { "p_ref": string }; Returns: Json
                           },
"resolve_tranche_reference":
{ Args: { "p_ref": string }; Returns: {
              "amount_minor": number,"expires_at": string,"label": string,"status": Database["public"]['Enums']["tranche_status"],"tranche_id": string,"tx_id": string,"used": boolean
            }[]
                           },
"respond_dispute":
{ Args: { "p_dispute": string,"p_text": string }; Returns: {
              "id": string,
"opened_at": string,
"opened_by": string,
"reason": string,
"reason_code": string | null,
"resolution_note": string | null,
"resolved_at": string | null,
"resolved_by": string | null,
"responded_at": string | null,
"responded_by": string | null,
"response": string | null,
"status": string,
"tranche_id": string,
"tx_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "disputes"
        isOneToOne: true
        isSetofReturn: false
      } },
"revoke_token":
{ Args: { "p_reason": string,"p_tranche": string }; Returns: Json
                           },
"save_draft":
{ Args: { "p_draft": Json }; Returns: Json
                           },
"search_providers":
{ Args: { "p_query": string,"p_vertical": string }; Returns: {
              "city": string,"id": string,"name": string,"verified": boolean,"verticals": (string)[]
            }[]
                           },
"simulate_system_transition":
{ Args: { "p_to": Database["public"]['Enums']["tx_status"],"p_tx": string }; Returns: {
              "amount_minor": number | null,
"beneficiary_name": string | null,
"created_at": string,
"created_by": string,
"currency": Database["public"]['Enums']["currency"] | null,
"draft_data": NonNullable<Json>,
"due_date": string | null,
"expires_at": string | null,
"id": string,
"plan_type": string | null,
"provider_id": string | null,
"provider_name": string | null,
"purpose": string | null,
"reject_reason": string | null,
"status": Database["public"]['Enums']["tx_status"],
"updated_at": string,
"vertical": string
            }
                          SetofOptions: {
        from: "*"
        to: "transactions"
        isOneToOne: true
        isSetofReturn: false
      } },
"simulate_tranche_system":
{ Args: { "p_to": Database["public"]['Enums']["tranche_status"],"p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"start_payment":
{ Args: { "p_idempotency_key": string,"p_method"?: string,"p_tranche": string }; Returns: Json
                           },
"status_ok":
{ Args: { "p_tx": string }; Returns: boolean
                           },
"transition_tranche":
{ Args: { "p_reason"?: string,"p_to": Database["public"]['Enums']["tranche_status"],"p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
"first_viewed_at": string | null,
"id": string,
"label": string,
"release_mode": Database["public"]['Enums']["release_mode"],
"released_at": string | null,
"seq": number,
"status": Database["public"]['Enums']["tranche_status"],
"tx_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "tranches"
        isOneToOne: true
        isSetofReturn: false
      } },
"transition_tx":
{ Args: { "p_reason"?: string,"p_to": Database["public"]['Enums']["tx_status"],"p_tx": string }; Returns: {
              "amount_minor": number | null,
"beneficiary_name": string | null,
"created_at": string,
"created_by": string,
"currency": Database["public"]['Enums']["currency"] | null,
"draft_data": NonNullable<Json>,
"due_date": string | null,
"expires_at": string | null,
"id": string,
"plan_type": string | null,
"provider_id": string | null,
"provider_name": string | null,
"purpose": string | null,
"reject_reason": string | null,
"status": Database["public"]['Enums']["tx_status"],
"updated_at": string,
"vertical": string
            }
                          SetofOptions: {
        from: "*"
        to: "transactions"
        isOneToOne: true
        isSetofReturn: false
      } },
"verify_audit":
{ Args: { "p_tx": string }; Returns: boolean
                           }
          }
          Enums: {
            "currency": "EUR"|"USD"|"XAF","payment_status": "PENDING"|"SUCCEEDED"|"FAILED"|"REFUNDED","platform_role": "USER"|"VALIDATOR"|"ADMIN","recurrence_freq": "WEEKLY"|"MONTHLY"|"QUARTERLY","release_mode": "PROVIDER_CONFIRM"|"PAYER_CONFIRM"|"EVIDENCE_REVIEW"|"AUTO"|"IMMEDIATE","tranche_status": "PLANNED"|"AWAITING_PAYMENT"|"PAID_LOCKED"|"EVIDENCE_SUBMITTED"|"CONFIRMED"|"RELEASED"|"DISPUTED"|"CANCELLED"|"EXPIRED"|"INFO_REQUESTED"|"REJECTED","tx_role": "PAYER"|"REQUESTER"|"PROVIDER"|"SYSTEM","tx_status": "DRAFT"|"SUBMITTED"|"IN_REVIEW"|"REJECTED"|"VALIDATED"|"TOKEN_ISSUED"|"AWAITING_PAYMENT"|"EXPIRED"|"CANCELLED"|"PAID_LOCKED"|"SERVICE_CONFIRMED"|"RELEASED"|"CLOSED"|"DISPUTED"|"IN_PROGRESS","vertical": "EDUCATION"|"HEALTH"|"RENT"|"AGRO"|"REAL_ESTATE"|"LAND"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "currency": ["EUR", "USD", "XAF"],"payment_status": ["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"],"platform_role": ["USER", "VALIDATOR", "ADMIN"],"recurrence_freq": ["WEEKLY", "MONTHLY", "QUARTERLY"],"release_mode": ["PROVIDER_CONFIRM", "PAYER_CONFIRM", "EVIDENCE_REVIEW", "AUTO", "IMMEDIATE"],"tranche_status": ["PLANNED", "AWAITING_PAYMENT", "PAID_LOCKED", "EVIDENCE_SUBMITTED", "CONFIRMED", "RELEASED", "DISPUTED", "CANCELLED", "EXPIRED", "INFO_REQUESTED", "REJECTED"],"tx_role": ["PAYER", "REQUESTER", "PROVIDER", "SYSTEM"],"tx_status": ["DRAFT", "SUBMITTED", "IN_REVIEW", "REJECTED", "VALIDATED", "TOKEN_ISSUED", "AWAITING_PAYMENT", "EXPIRED", "CANCELLED", "PAID_LOCKED", "SERVICE_CONFIRMED", "RELEASED", "CLOSED", "DISPUTED", "IN_PROGRESS"],"vertical": ["EDUCATION", "HEALTH", "RENT", "AGRO", "REAL_ESTATE", "LAND"]
          }
        }
} as const
