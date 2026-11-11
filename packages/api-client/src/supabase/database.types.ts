// Fichier généré par `pnpm db:types` (supabase gen types) : ne pas modifier à la main.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "allowed_transitions": {
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
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"disputes": {
                  Row: {
                    "id": string,"opened_at": string,"opened_by": string,"reason": string,"reason_code": string | null,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"status": string,"tranche_id": string,"tx_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"opened_at"?: string,"opened_by": string,"reason": string,"reason_code"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"tranche_id": string,"tx_id": string
                  }
                  Update: {
                    "id"?: string,"opened_at"?: string,"opened_by"?: string,"reason"?: string,"reason_code"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"tranche_id"?: string,"tx_id"?: string
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
      foreignKeyName: "disputes_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
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
                    "created_at": string,"deleted_at": string | null,"file_name": string | null,"id": string,"kind": string,"mime_type": string,"size_bytes": number,"storage_path": string,"tranche_id": string | null,"tx_id": string,"uploaded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"file_name"?: string | null,"id"?: string,"kind": string,"mime_type": string,"size_bytes": number,"storage_path": string,"tranche_id"?: string | null,"tx_id": string,"uploaded_by": string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"file_name"?: string | null,"id"?: string,"kind"?: string,"mime_type"?: string,"size_bytes"?: number,"storage_path"?: string,"tranche_id"?: string | null,"tx_id"?: string,"uploaded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
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
      referencedRelation: "tranches"
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
                    "country": string | null,"created_at": string,"full_name": string,"id": string,"kyc_status": string,"locale": string,"phone": string | null,"platform_role": Database["public"]['Enums']["platform_role"],"primary_role": string | null,"push_enabled": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "country"?: string | null,"created_at"?: string,"full_name": string,"id": string,"kyc_status"?: string,"locale"?: string,"phone"?: string | null,"platform_role"?: Database["public"]['Enums']["platform_role"],"primary_role"?: string | null,"push_enabled"?: boolean
                  }
                  Update: {
                    "country"?: string | null,"created_at"?: string,"full_name"?: string,"id"?: string,"kyc_status"?: string,"locale"?: string,"phone"?: string | null,"platform_role"?: Database["public"]['Enums']["platform_role"],"primary_role"?: string | null,"push_enabled"?: boolean
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
      referencedRelation: "tranches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "release_events_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"release_rules": {
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
                },"required_documents": {
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
                    "created_at": string,"expires_at": string,"kid": string,"reference": string,"signature": string,"simulated": boolean,"tranche_id": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"kid": string,"reference"?: string,"signature": string,"simulated"?: boolean,"tranche_id": string,"used_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"kid"?: string,"reference"?: string,"signature"?: string,"simulated"?: boolean,"tranche_id"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tranche_tokens_kid_fkey"
      columns: ["kid"]
isOneToOne: false
      referencedRelation: "signing_keys"
      referencedColumns: ["kid"]
    },{
      foreignKeyName: "tranche_tokens_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: true
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
                    "amount_minor": number,"contest_ends_at": string | null,"contest_hours": number,"created_at": string,"due_date": string | null,"id": string,"label": string,"release_mode": Database["public"]['Enums']["release_mode"],"released_at": string | null,"seq": number,"status": Database["public"]['Enums']["tranche_status"],"tx_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"contest_ends_at"?: string | null,"contest_hours"?: number,"created_at"?: string,"due_date"?: string | null,"id"?: string,"label": string,"release_mode": Database["public"]['Enums']["release_mode"],"released_at"?: string | null,"seq": number,"status"?: Database["public"]['Enums']["tranche_status"],"tx_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_minor"?: number,"contest_ends_at"?: string | null,"contest_hours"?: number,"created_at"?: string,"due_date"?: string | null,"id"?: string,"label"?: string,"release_mode"?: Database["public"]['Enums']["release_mode"],"released_at"?: string | null,"seq"?: number,"status"?: Database["public"]['Enums']["tranche_status"],"tx_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tranches_tx_id_fkey"
      columns: ["tx_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"transaction_parties": {
                  Row: {
                    "invited_phone": string | null,"role": Database["public"]['Enums']["tx_role"],"tx_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "invited_phone"?: string | null,"role": Database["public"]['Enums']["tx_role"],"tx_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "invited_phone"?: string | null,"role"?: Database["public"]['Enums']["tx_role"],"tx_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
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
                    "amount_minor": number | null,"beneficiary_name": string | null,"created_at": string,"created_by": string,"currency": Database["public"]['Enums']["currency"] | null,"draft_data": NonNullable<Json>,"due_date": string | null,"expires_at": string | null,"id": string,"plan_type": string | null,"provider_id": string | null,"provider_name": string | null,"purpose": string | null,"reject_reason": string | null,"status": Database["public"]['Enums']["tx_status"],"updated_at": string,"vertical": Database["public"]['Enums']["vertical"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor"?: number | null,"beneficiary_name"?: string | null,"created_at"?: string,"created_by": string,"currency"?: Database["public"]['Enums']["currency"] | null,"draft_data"?: NonNullable<Json>,"due_date"?: string | null,"expires_at"?: string | null,"id"?: string,"plan_type"?: string | null,"provider_id"?: string | null,"provider_name"?: string | null,"purpose"?: string | null,"reject_reason"?: string | null,"status"?: Database["public"]['Enums']["tx_status"],"updated_at"?: string,"vertical": Database["public"]['Enums']["vertical"]
                  }
                  Update: {
                    "amount_minor"?: number | null,"beneficiary_name"?: string | null,"created_at"?: string,"created_by"?: string,"currency"?: Database["public"]['Enums']["currency"] | null,"draft_data"?: NonNullable<Json>,"due_date"?: string | null,"expires_at"?: string | null,"id"?: string,"plan_type"?: string | null,"provider_id"?: string | null,"provider_name"?: string | null,"purpose"?: string | null,"reject_reason"?: string | null,"status"?: Database["public"]['Enums']["tx_status"],"updated_at"?: string,"vertical"?: Database["public"]['Enums']["vertical"]
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
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"validations": {
                  Row: {
                    "approved": boolean,"decided_at": string,"id": string,"reason": string | null,"tranche_id": string | null,"tx_id": string,"validator_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved": boolean,"decided_at"?: string,"id"?: string,"reason"?: string | null,"tranche_id"?: string | null,"tx_id": string,"validator_id": string
                  }
                  Update: {
                    "approved"?: boolean,"decided_at"?: string,"id"?: string,"reason"?: string | null,"tranche_id"?: string | null,"tx_id"?: string,"validator_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "validations_tranche_id_fkey"
      columns: ["tranche_id"]
isOneToOne: false
      referencedRelation: "tranches"
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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "_draft_json":
{ Args: { "p_tx": string }; Returns: Json
                           },
"_err":
{ Args: { "p_code": string,"p_detail"?: string,"p_message": string }; Returns: undefined
                           },
"_fold":
{ Args: { "p": string }; Returns: string
                           },
"_issue_tranche_token":
{ Args: { "p_tranche": string }; Returns: undefined
                           },
"_mock_mode":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"_norm_phone":
{ Args: { "p": string }; Returns: string
                           },
"_require_user":
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
"_set_tranche_status":
{ Args: { "p_actor": string,"p_event": string,"p_payload"?: Json,"p_to": Database["public"]['Enums']["tranche_status"],"p_tranche": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
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
"_storage_tx":
{ Args: { "p_name": string }; Returns: string
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
{ Args: { "p_kind": string,"p_mime": string,"p_name": string,"p_path": string,"p_size": number,"p_tx": string }; Returns: Json
                           },
"confirm_by_reference":
{ Args: { "p_device_time"?: string,"p_ref": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
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
"vertical": Database["public"]['Enums']["vertical"]
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
"vertical": Database["public"]['Enums']["vertical"]
            }
                          SetofOptions: {
        from: "*"
        to: "transactions"
        isOneToOne: true
        isSetofReturn: false
      } },
"generate_recurring_tranches":
{ Args: { "p_freq": Database["public"]['Enums']["recurrence_freq"],"p_label"?: string,"p_n": number,"p_start": string,"p_tx": string }; Returns: {
              "amount_minor": number,
"contest_ends_at": string | null,
"contest_hours": number,
"created_at": string,
"due_date": string | null,
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
"release_due_tranches":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"remove_document":
{ Args: { "p_doc": string }; Returns: string
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
"vertical": Database["public"]['Enums']["vertical"]
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
"vertical": Database["public"]['Enums']["vertical"]
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
            "currency": "EUR"|"USD"|"XAF","payment_status": "PENDING"|"SUCCEEDED"|"FAILED"|"REFUNDED","platform_role": "USER"|"VALIDATOR"|"ADMIN","recurrence_freq": "WEEKLY"|"MONTHLY"|"QUARTERLY","release_mode": "PROVIDER_CONFIRM"|"PAYER_CONFIRM"|"EVIDENCE_REVIEW"|"AUTO","tranche_status": "PLANNED"|"AWAITING_PAYMENT"|"PAID_LOCKED"|"EVIDENCE_SUBMITTED"|"CONFIRMED"|"RELEASED"|"DISPUTED"|"CANCELLED"|"EXPIRED","tx_role": "PAYER"|"REQUESTER"|"PROVIDER"|"SYSTEM","tx_status": "DRAFT"|"SUBMITTED"|"IN_REVIEW"|"REJECTED"|"VALIDATED"|"TOKEN_ISSUED"|"AWAITING_PAYMENT"|"EXPIRED"|"CANCELLED"|"PAID_LOCKED"|"SERVICE_CONFIRMED"|"RELEASED"|"CLOSED"|"DISPUTED"|"IN_PROGRESS","vertical": "EDUCATION"|"HEALTH"|"RENT"|"AGRO"|"REAL_ESTATE"|"LAND"
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
            "currency": ["EUR", "USD", "XAF"],"payment_status": ["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"],"platform_role": ["USER", "VALIDATOR", "ADMIN"],"recurrence_freq": ["WEEKLY", "MONTHLY", "QUARTERLY"],"release_mode": ["PROVIDER_CONFIRM", "PAYER_CONFIRM", "EVIDENCE_REVIEW", "AUTO"],"tranche_status": ["PLANNED", "AWAITING_PAYMENT", "PAID_LOCKED", "EVIDENCE_SUBMITTED", "CONFIRMED", "RELEASED", "DISPUTED", "CANCELLED", "EXPIRED"],"tx_role": ["PAYER", "REQUESTER", "PROVIDER", "SYSTEM"],"tx_status": ["DRAFT", "SUBMITTED", "IN_REVIEW", "REJECTED", "VALIDATED", "TOKEN_ISSUED", "AWAITING_PAYMENT", "EXPIRED", "CANCELLED", "PAID_LOCKED", "SERVICE_CONFIRMED", "RELEASED", "CLOSED", "DISPUTED", "IN_PROGRESS"],"vertical": ["EDUCATION", "HEALTH", "RENT", "AGRO", "REAL_ESTATE", "LAND"]
          }
        }
} as const
