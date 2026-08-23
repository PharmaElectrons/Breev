export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_entries: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          currency: string
          description: string | null
          entry_date: string
          entry_type: string
          exchange_rate: number
          id: string
          iqd_equivalent: number
        }
        Insert: {
          account_id: string
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          entry_date?: string
          entry_type?: string
          exchange_rate?: number
          id?: string
          iqd_equivalent?: number
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          entry_date?: string
          entry_type?: string
          exchange_rate?: number
          id?: string
          iqd_equivalent?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_transactions: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          entry_date: string
          entry_type: string
          exchange_rate: number
          id: string
          iqd_equivalent: number
          reference: string | null
        }
        Insert: {
          account_id: string
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          entry_date?: string
          entry_type?: string
          exchange_rate?: number
          id?: string
          iqd_equivalent?: number
          reference?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          entry_date?: string
          entry_type?: string
          exchange_rate?: number
          id?: string
          iqd_equivalent?: number
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          credit_limit: number
          default_discount_pct: number
          due_period_days: number
          id: string
          location: string | null
          name: string
          notes: string | null
          opening_balance: number
          payment_terms: string
          phone: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credit_limit?: number
          default_discount_pct?: number
          due_period_days?: number
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          opening_balance?: number
          payment_terms?: string
          phone?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credit_limit?: number
          default_discount_pct?: number
          due_period_days?: number
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          opening_balance?: number
          payment_terms?: string
          phone?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string
          id: string
          password: string
          permissions: string[]
          role: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          password?: string
          permissions?: string[]
          role?: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          password?: string
          permissions?: string[]
          role?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          name?: string
        }
        Relationships: []
      }
      chronic_schedule: {
        Row: {
          created_at: string
          days_per_cycle: number
          id: string
          medicine_id: string
          medicine_name: string
          patient_id: string
          patient_name: string
          patient_notified: boolean
          patient_phone: string | null
          purchased_at: string
          reorder_alerted: boolean
        }
        Insert: {
          created_at?: string
          days_per_cycle?: number
          id?: string
          medicine_id: string
          medicine_name: string
          patient_id: string
          patient_name: string
          patient_notified?: boolean
          patient_phone?: string | null
          purchased_at?: string
          reorder_alerted?: boolean
        }
        Update: {
          created_at?: string
          days_per_cycle?: number
          id?: string
          medicine_id?: string
          medicine_name?: string
          patient_id?: string
          patient_name?: string
          patient_notified?: boolean
          patient_phone?: string | null
          purchased_at?: string
          reorder_alerted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "chronic_schedule_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "expiring_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chronic_schedule_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "low_stock_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chronic_schedule_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chronic_schedule_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "top_selling_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chronic_schedule_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_roles: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          key: string
          label: string
          permissions: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          key: string
          label: string
          permissions?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          key?: string
          label?: string
          permissions?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          balance: number
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          actual_worked: number
          check_in: string | null
          check_out: string | null
          created_at: string
          hourly_rate: number
          id: string
          name: string
          password: string | null
          permissions: Json
          phone: string | null
          role_key: string | null
          salary: number
          shift: string | null
          shift_hours: number
          status: string
          updated_at: string
          username: string | null
        }
        Insert: {
          actual_worked?: number
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          hourly_rate?: number
          id?: string
          name: string
          password?: string | null
          permissions?: Json
          phone?: string | null
          role_key?: string | null
          salary?: number
          shift?: string | null
          shift_hours?: number
          status?: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          actual_worked?: number
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          hourly_rate?: number
          id?: string
          name?: string
          password?: string | null
          permissions?: Json
          phone?: string | null
          role_key?: string | null
          salary?: number
          shift?: string | null
          shift_hours?: number
          status?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          account_id: string | null
          amount: number
          category: string
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          expense_date: string
          id: string
          paid_to: string | null
        }
        Insert: {
          account_id?: string | null
          amount?: number
          category: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          expense_date?: string
          id?: string
          paid_to?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          expense_date?: string
          id?: string
          paid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      income: {
        Row: {
          account_id: string | null
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          income_date: string
          source: string
        }
        Insert: {
          account_id?: string | null
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          income_date?: string
          source: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          income_date?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "income_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_comments: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          invoice_kind: string
          purchase_invoice_id: string | null
          sales_invoice_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_kind: string
          purchase_invoice_id?: string | null
          sales_invoice_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_kind?: string
          purchase_invoice_id?: string | null
          sales_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_comments_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_comments_sales_invoice_id_fkey"
            columns: ["sales_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      medicine_batches: {
        Row: {
          batch_number: string
          created_at: string
          expiry_date: string | null
          id: string
          medicine_id: string
          notes: string | null
          purchase_price: number
          quantity: number
          received_at: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          batch_number: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          medicine_id: string
          notes?: string | null
          purchase_price?: number
          quantity?: number
          received_at?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          batch_number?: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          medicine_id?: string
          notes?: string | null
          purchase_price?: number
          quantity?: number
          received_at?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicine_batches_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "expiring_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_batches_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "low_stock_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_batches_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_batches_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "top_selling_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      medicine_branch_stocks: {
        Row: {
          branch_id: string
          id: string
          medicine_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          id?: string
          medicine_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          id?: string
          medicine_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicine_branch_stocks_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_branch_stocks_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "expiring_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_branch_stocks_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "low_stock_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_branch_stocks_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_branch_stocks_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "top_selling_medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      medicine_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      medicines: {
        Row: {
          agent_price: number
          barcode: string | null
          batch_number: string | null
          category: string | null
          company: string | null
          created_at: string
          daily_frequency: number
          days_per_cycle: number
          dosage_form: string | null
          expiry_date: string | null
          highlight_color: string | null
          id: string
          is_active: boolean
          large_unit_cost: number
          large_unit_name: string | null
          large_unit_price: number
          location: string | null
          maximum_stock: number
          meal_timing: string
          minimum_stock: number
          notes: string | null
          publish_online: boolean
          purchase_price: number
          quantity_in_stock: number
          scientific_name: string
          selling_price: number
          small_unit_cost: number
          small_unit_name: string | null
          small_unit_price: number
          strength: string | null
          trade_name: string
          units_per_large: number
          updated_at: string
          wholesale_large_price: number
          wholesale_small_price: number
        }
        Insert: {
          agent_price?: number
          barcode?: string | null
          batch_number?: string | null
          category?: string | null
          company?: string | null
          created_at?: string
          daily_frequency?: number
          days_per_cycle?: number
          dosage_form?: string | null
          expiry_date?: string | null
          highlight_color?: string | null
          id?: string
          is_active?: boolean
          large_unit_cost?: number
          large_unit_name?: string | null
          large_unit_price?: number
          location?: string | null
          maximum_stock?: number
          meal_timing?: string
          minimum_stock?: number
          notes?: string | null
          publish_online?: boolean
          purchase_price?: number
          quantity_in_stock?: number
          scientific_name: string
          selling_price?: number
          small_unit_cost?: number
          small_unit_name?: string | null
          small_unit_price?: number
          strength?: string | null
          trade_name: string
          units_per_large?: number
          updated_at?: string
          wholesale_large_price?: number
          wholesale_small_price?: number
        }
        Update: {
          agent_price?: number
          barcode?: string | null
          batch_number?: string | null
          category?: string | null
          company?: string | null
          created_at?: string
          daily_frequency?: number
          days_per_cycle?: number
          dosage_form?: string | null
          expiry_date?: string | null
          highlight_color?: string | null
          id?: string
          is_active?: boolean
          large_unit_cost?: number
          large_unit_name?: string | null
          large_unit_price?: number
          location?: string | null
          maximum_stock?: number
          meal_timing?: string
          minimum_stock?: number
          notes?: string | null
          publish_online?: boolean
          purchase_price?: number
          quantity_in_stock?: number
          scientific_name?: string
          selling_price?: number
          small_unit_cost?: number
          small_unit_name?: string | null
          small_unit_price?: number
          strength?: string | null
          trade_name?: string
          units_per_large?: number
          updated_at?: string
          wholesale_large_price?: number
          wholesale_small_price?: number
        }
        Relationships: []
      }
      message_log: {
        Row: {
          body: string
          channel: string
          id: string
          patient_id: string | null
          phone: string | null
          sent_at: string
        }
        Insert: {
          body: string
          channel?: string
          id?: string
          patient_id?: string | null
          phone?: string | null
          sent_at?: string
        }
        Update: {
          body?: string
          channel?: string
          id?: string
          patient_id?: string | null
          phone?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_log_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      message_logs: {
        Row: {
          body: string
          channel: string
          created_by: string | null
          customer_id: string | null
          id: string
          patient_id: string | null
          phone: string | null
          sent_at: string
          status: string
          subject: string | null
        }
        Insert: {
          body: string
          channel?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          patient_id?: string | null
          phone?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
        }
        Update: {
          body?: string
          channel?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          patient_id?: string | null
          phone?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          kind: string
          ref_id: string | null
          ref_table: string | null
          target_user_id: string | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          kind?: string
          ref_id?: string | null
          ref_table?: string | null
          target_user_id?: string | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          kind?: string
          ref_id?: string | null
          ref_table?: string | null
          target_user_id?: string | null
          title?: string
        }
        Relationships: []
      }
      patient_extras: {
        Row: {
          dob: string | null
          patient_id: string
          updated_at: string
        }
        Insert: {
          dob?: string | null
          patient_id: string
          updated_at?: string
        }
        Update: {
          dob?: string | null
          patient_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_extras_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_files: {
        Row: {
          category: string | null
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          patient_id: string
          size_bytes: number | null
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          patient_id: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          patient_id?: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_files_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_labs: {
        Row: {
          created_at: string
          id: string
          lab_date: string
          patient_id: string
          test: string
          value_text: string
        }
        Insert: {
          created_at?: string
          id?: string
          lab_date?: string
          patient_id: string
          test: string
          value_text?: string
        }
        Update: {
          created_at?: string
          id?: string
          lab_date?: string
          patient_id?: string
          test?: string
          value_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_labs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_pharmacy_history: {
        Row: {
          created_at: string
          first_purchase: string
          id: string
          item: string
          last_purchase: string
          patient_id: string
        }
        Insert: {
          created_at?: string
          first_purchase?: string
          id?: string
          item: string
          last_purchase?: string
          patient_id: string
        }
        Update: {
          created_at?: string
          first_purchase?: string
          id?: string
          item?: string
          last_purchase?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_pharmacy_history_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_reservations: {
        Row: {
          created_at: string
          id: string
          medicine_id: string
          medicine_name: string
          notified_at: string | null
          patient_id: string
          patient_name: string
          patient_phone: string | null
          qty: number
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          medicine_id: string
          medicine_name: string
          notified_at?: string | null
          patient_id: string
          patient_name: string
          patient_phone?: string | null
          qty?: number
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          medicine_id?: string
          medicine_name?: string
          notified_at?: string | null
          patient_id?: string
          patient_name?: string
          patient_phone?: string | null
          qty?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_reservations_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "expiring_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_reservations_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "low_stock_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_reservations_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_reservations_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "top_selling_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_reservations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_visits: {
        Row: {
          created_at: string
          diagnosis: string
          doctor: string
          id: string
          patient_id: string
          prescribed: string[]
          specialty: string | null
          visit_date: string
        }
        Insert: {
          created_at?: string
          diagnosis?: string
          doctor?: string
          id?: string
          patient_id: string
          prescribed?: string[]
          specialty?: string | null
          visit_date?: string
        }
        Update: {
          created_at?: string
          diagnosis?: string
          doctor?: string
          id?: string
          patient_id?: string
          prescribed?: string[]
          specialty?: string | null
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_visits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_weight_logs: {
        Row: {
          created_at: string
          id: string
          kg: number
          log_date: string
          patient_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kg: number
          log_date?: string
          patient_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kg?: number
          log_date?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_weight_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          address: string | null
          age: number | null
          allergies: string[]
          chronic_diseases: string[]
          chronic_meds: string[]
          created_at: string
          full_name: string
          gender: string | null
          has_allergy: boolean
          height_cm: number | null
          id: string
          interests: string[]
          is_smoker: boolean
          notes: string | null
          phone: string | null
          updated_at: string
          uses_alcohol: boolean
          weight_kg: number | null
        }
        Insert: {
          address?: string | null
          age?: number | null
          allergies?: string[]
          chronic_diseases?: string[]
          chronic_meds?: string[]
          created_at?: string
          full_name: string
          gender?: string | null
          has_allergy?: boolean
          height_cm?: number | null
          id?: string
          interests?: string[]
          is_smoker?: boolean
          notes?: string | null
          phone?: string | null
          updated_at?: string
          uses_alcohol?: boolean
          weight_kg?: number | null
        }
        Update: {
          address?: string | null
          age?: number | null
          allergies?: string[]
          chronic_diseases?: string[]
          chronic_meds?: string[]
          created_at?: string
          full_name?: string
          gender?: string | null
          has_allergy?: boolean
          height_cm?: number | null
          id?: string
          interests?: string[]
          is_smoker?: boolean
          notes?: string | null
          phone?: string | null
          updated_at?: string
          uses_alcohol?: boolean
          weight_kg?: number | null
        }
        Relationships: []
      }
      pharmacy_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      prescription_items: {
        Row: {
          created_at: string
          dose: string | null
          duration_days: number | null
          frequency: string | null
          id: string
          medicine_id: string | null
          medicine_name: string
          notes: string | null
          prescription_id: string
          qty: number
        }
        Insert: {
          created_at?: string
          dose?: string | null
          duration_days?: number | null
          frequency?: string | null
          id?: string
          medicine_id?: string | null
          medicine_name: string
          notes?: string | null
          prescription_id: string
          qty?: number
        }
        Update: {
          created_at?: string
          dose?: string | null
          duration_days?: number | null
          frequency?: string | null
          id?: string
          medicine_id?: string | null
          medicine_name?: string
          notes?: string | null
          prescription_id?: string
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "expiring_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "low_stock_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "top_selling_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string
          created_by: string | null
          diagnosis: string | null
          doctor: string | null
          id: string
          issued_at: string
          notes: string | null
          patient_id: string
          specialty: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          doctor?: string | null
          id?: string
          issued_at?: string
          notes?: string | null
          patient_id: string
          specialty?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          doctor?: string | null
          id?: string
          issued_at?: string
          notes?: string | null
          patient_id?: string
          specialty?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoice_items: {
        Row: {
          id: string
          invoice_id: string
          line_total: number
          medicine_id: string
          qty: number
          unit_cost: number
        }
        Insert: {
          id?: string
          invoice_id: string
          line_total: number
          medicine_id: string
          qty: number
          unit_cost: number
        }
        Update: {
          id?: string
          invoice_id?: string
          line_total?: number
          medicine_id?: string
          qty?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "expiring_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "low_stock_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "top_selling_medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoices: {
        Row: {
          created_at: string
          created_by: string | null
          discount: number
          employee_id: string | null
          id: string
          invoice_no: number
          notes: string | null
          paid_amount: number
          payment_type: string
          status: string
          subtotal: number
          supplier_id: string | null
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discount?: number
          employee_id?: string | null
          id?: string
          invoice_no?: number
          notes?: string | null
          paid_amount?: number
          payment_type?: string
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discount?: number
          employee_id?: string | null
          id?: string
          invoice_no?: number
          notes?: string | null
          paid_amount?: number
          payment_type?: string
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          kind: string
          name: string
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          name: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_invoice_items: {
        Row: {
          id: string
          invoice_id: string
          line_total: number
          medicine_id: string
          qty: number
          unit_price: number
        }
        Insert: {
          id?: string
          invoice_id: string
          line_total: number
          medicine_id: string
          qty: number
          unit_price: number
        }
        Update: {
          id?: string
          invoice_id?: string
          line_total?: number
          medicine_id?: string
          qty?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "expiring_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "low_stock_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "top_selling_medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoices: {
        Row: {
          addon: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount: number
          employee_id: string | null
          id: string
          invoice_no: number
          paid_amount: number
          patient_id: string | null
          payment_type: string
          status: string
          subtotal: number
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          addon?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          employee_id?: string | null
          id?: string
          invoice_no?: number
          paid_amount?: number
          patient_id?: string | null
          payment_type?: string
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          addon?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          employee_id?: string | null
          id?: string
          invoice_no?: number
          paid_amount?: number
          patient_id?: string | null
          payment_type?: string
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          delta: number
          id: string
          medicine_id: string
          reason: string
          ref_id: string | null
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          medicine_id: string
          reason: string
          ref_id?: string | null
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          medicine_id?: string
          reason?: string
          ref_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "expiring_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "low_stock_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "top_selling_medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          created_at: string
          credit_limit: number
          default_discount_pct: number
          due_period_days: number
          email: string | null
          id: string
          name: string
          notes: string | null
          payment_terms: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          credit_limit?: number
          default_discount_pct?: number
          due_period_days?: number
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          payment_terms?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          credit_limit?: number
          default_discount_pct?: number
          due_period_days?: number
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          payment_terms?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          app_user_id: string
          granted_at: string
          id: string
          permission: string
        }
        Insert: {
          app_user_id: string
          granted_at?: string
          id?: string
          permission: string
        }
        Update: {
          app_user_id?: string
          granted_at?: string
          id?: string
          permission?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      daily_sales: {
        Row: {
          addon: number | null
          day: string | null
          discount: number | null
          invoice_count: number | null
          subtotal: number | null
          tax: number | null
          total: number | null
        }
        Relationships: []
      }
      expiring_medicines: {
        Row: {
          barcode: string | null
          batch_number: string | null
          category: string | null
          company: string | null
          created_at: string | null
          dosage_form: string | null
          expiry_date: string | null
          id: string | null
          is_active: boolean | null
          large_unit_cost: number | null
          large_unit_name: string | null
          large_unit_price: number | null
          location: string | null
          maximum_stock: number | null
          minimum_stock: number | null
          notes: string | null
          purchase_price: number | null
          quantity_in_stock: number | null
          scientific_name: string | null
          selling_price: number | null
          small_unit_cost: number | null
          small_unit_name: string | null
          small_unit_price: number | null
          strength: string | null
          trade_name: string | null
          units_per_large: number | null
          updated_at: string | null
        }
        Insert: {
          barcode?: string | null
          batch_number?: string | null
          category?: string | null
          company?: string | null
          created_at?: string | null
          dosage_form?: string | null
          expiry_date?: string | null
          id?: string | null
          is_active?: boolean | null
          large_unit_cost?: number | null
          large_unit_name?: string | null
          large_unit_price?: number | null
          location?: string | null
          maximum_stock?: number | null
          minimum_stock?: number | null
          notes?: string | null
          purchase_price?: number | null
          quantity_in_stock?: number | null
          scientific_name?: string | null
          selling_price?: number | null
          small_unit_cost?: number | null
          small_unit_name?: string | null
          small_unit_price?: number | null
          strength?: string | null
          trade_name?: string | null
          units_per_large?: number | null
          updated_at?: string | null
        }
        Update: {
          barcode?: string | null
          batch_number?: string | null
          category?: string | null
          company?: string | null
          created_at?: string | null
          dosage_form?: string | null
          expiry_date?: string | null
          id?: string | null
          is_active?: boolean | null
          large_unit_cost?: number | null
          large_unit_name?: string | null
          large_unit_price?: number | null
          location?: string | null
          maximum_stock?: number | null
          minimum_stock?: number | null
          notes?: string | null
          purchase_price?: number | null
          quantity_in_stock?: number | null
          scientific_name?: string | null
          selling_price?: number | null
          small_unit_cost?: number | null
          small_unit_name?: string | null
          small_unit_price?: number | null
          strength?: string | null
          trade_name?: string | null
          units_per_large?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inventory_summary: {
        Row: {
          expiring_count: number | null
          low_stock_count: number | null
          out_of_stock_count: number | null
          total_items: number | null
          total_units: number | null
          total_value_cost: number | null
          total_value_retail: number | null
        }
        Relationships: []
      }
      low_stock_medicines: {
        Row: {
          barcode: string | null
          batch_number: string | null
          category: string | null
          company: string | null
          created_at: string | null
          dosage_form: string | null
          expiry_date: string | null
          id: string | null
          is_active: boolean | null
          large_unit_cost: number | null
          large_unit_name: string | null
          large_unit_price: number | null
          location: string | null
          maximum_stock: number | null
          minimum_stock: number | null
          notes: string | null
          purchase_price: number | null
          quantity_in_stock: number | null
          scientific_name: string | null
          selling_price: number | null
          small_unit_cost: number | null
          small_unit_name: string | null
          small_unit_price: number | null
          strength: string | null
          trade_name: string | null
          units_per_large: number | null
          updated_at: string | null
        }
        Insert: {
          barcode?: string | null
          batch_number?: string | null
          category?: string | null
          company?: string | null
          created_at?: string | null
          dosage_form?: string | null
          expiry_date?: string | null
          id?: string | null
          is_active?: boolean | null
          large_unit_cost?: number | null
          large_unit_name?: string | null
          large_unit_price?: number | null
          location?: string | null
          maximum_stock?: number | null
          minimum_stock?: number | null
          notes?: string | null
          purchase_price?: number | null
          quantity_in_stock?: number | null
          scientific_name?: string | null
          selling_price?: number | null
          small_unit_cost?: number | null
          small_unit_name?: string | null
          small_unit_price?: number | null
          strength?: string | null
          trade_name?: string | null
          units_per_large?: number | null
          updated_at?: string | null
        }
        Update: {
          barcode?: string | null
          batch_number?: string | null
          category?: string | null
          company?: string | null
          created_at?: string | null
          dosage_form?: string | null
          expiry_date?: string | null
          id?: string | null
          is_active?: boolean | null
          large_unit_cost?: number | null
          large_unit_name?: string | null
          large_unit_price?: number | null
          location?: string | null
          maximum_stock?: number | null
          minimum_stock?: number | null
          notes?: string | null
          purchase_price?: number | null
          quantity_in_stock?: number | null
          scientific_name?: string | null
          selling_price?: number | null
          small_unit_cost?: number | null
          small_unit_name?: string | null
          small_unit_price?: number | null
          strength?: string | null
          trade_name?: string | null
          units_per_large?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      monthly_sales: {
        Row: {
          addon: number | null
          discount: number | null
          invoice_count: number | null
          month: string | null
          subtotal: number | null
          tax: number | null
          total: number | null
        }
        Relationships: []
      }
      top_selling_medicines: {
        Row: {
          id: string | null
          invoice_count: number | null
          scientific_name: string | null
          total_qty: number | null
          total_revenue: number | null
          trade_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "admin" | "staff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff"],
    },
  },
} as const
