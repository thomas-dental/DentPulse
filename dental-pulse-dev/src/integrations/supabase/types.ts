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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accounting_connections: {
        Row: {
          access_token: string | null
          api_key_encrypted: string | null
          created_at: string
          created_by: string
          enabled_features: Json
          entity_name: string
          id: string
          iplicit_domain: string | null
          iplicit_username: string | null
          last_sync: string | null
          name: string
          organization_id: string
          platform: Database["public"]["Enums"]["accounting_platform"]
          realm_id: string | null
          refresh_token: string | null
          status: Database["public"]["Enums"]["connection_status"]
          sync_frequency: string
          tenant_id: string | null
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          api_key_encrypted?: string | null
          created_at?: string
          created_by: string
          enabled_features?: Json
          entity_name: string
          id?: string
          iplicit_domain?: string | null
          iplicit_username?: string | null
          last_sync?: string | null
          name: string
          organization_id: string
          platform: Database["public"]["Enums"]["accounting_platform"]
          realm_id?: string | null
          refresh_token?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          sync_frequency?: string
          tenant_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          api_key_encrypted?: string | null
          created_at?: string
          created_by?: string
          enabled_features?: Json
          entity_name?: string
          id?: string
          iplicit_domain?: string | null
          iplicit_username?: string | null
          last_sync?: string | null
          name?: string
          organization_id?: string
          platform?: Database["public"]["Enums"]["accounting_platform"]
          realm_id?: string | null
          refresh_token?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          sync_frequency?: string
          tenant_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts_payable_invoice: {
        Row: {
          account: string | null
          account_balance: number | null
          account_number: string | null
          amount: number | null
          amount_due: number | null
          balance_brought_forward: number | null
          bank_account_id: string | null
          billed_to: string | null
          brand_id: string | null
          charged: number | null
          confidence_score: number | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          customer_name: string | null
          customer_reference: string | null
          date_delivered: string | null
          due_date: string | null
          folder_id: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          is_approved_by_approver: number | null
          is_from_platform: boolean | null
          location_id: string | null
          order_number: string | null
          organization_id: string
          paid_at: string | null
          patient: string | null
          payment_due_by: string | null
          payments_received: number | null
          pdf_path: string | null
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
          platform_invoice_id: string | null
          platform_name: string | null
          platform_status: string | null
          previous_balance: number | null
          purchase_order: string | null
          raw_json: Json | null
          raw_text: string | null
          shared_at: string | null
          source: string | null
          status: string | null
          subtotal: number | null
          supply_address: string | null
          supply_point_id: string | null
          tax: number | null
          total_amount: number | null
          total_gbp: number | null
          total_no_vat: number | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
          vat_no: string | null
          vendor_address: string | null
          vendor_phone: string | null
          vendor_email: string | null
          vendor_name: string | null
        }
        Insert: {
          account?: string | null
          account_balance?: number | null
          account_number?: string | null
          amount?: number | null
          amount_due?: number | null
          balance_brought_forward?: number | null
          bank_account_id?: string | null
          billed_to?: string | null
          brand_id?: string | null
          charged?: number | null
          confidence_score?: number | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          customer_name?: string | null
          customer_reference?: string | null
          date_delivered?: string | null
          due_date?: string | null
          folder_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          is_approved_by_approver?: number | null
          is_from_platform?: boolean | null
          location_id?: string | null
          order_number?: string | null
          organization_id: string
          paid_at?: string | null
          patient?: string | null
          payment_due_by?: string | null
          payments_received?: number | null
          pdf_path?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          platform_invoice_id?: string | null
          platform_name?: string | null
          platform_status?: string | null
          previous_balance?: number | null
          purchase_order?: string | null
          raw_json?: Json | null
          raw_text?: string | null
          shared_at?: string | null
          source?: string | null
          status?: string | null
          subtotal?: number | null
          supply_address?: string | null
          supply_point_id?: string | null
          tax?: number | null
          total_amount?: number | null
          total_gbp?: number | null
          total_no_vat?: number | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          vat_no?: string | null
          vendor_address?: string | null
          vendor_phone?: string | null
          vendor_email?: string | null
          vendor_name?: string | null
        }
        Update: {
          account?: string | null
          account_balance?: number | null
          account_number?: string | null
          amount?: number | null
          amount_due?: number | null
          balance_brought_forward?: number | null
          bank_account_id?: string | null
          billed_to?: string | null
          brand_id?: string | null
          charged?: number | null
          confidence_score?: number | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          customer_name?: string | null
          customer_reference?: string | null
          date_delivered?: string | null
          due_date?: string | null
          folder_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          is_approved_by_approver?: number | null
          is_from_platform?: boolean | null
          location_id?: string | null
          order_number?: string | null
          organization_id?: string
          paid_at?: string | null
          patient?: string | null
          payment_due_by?: string | null
          payments_received?: number | null
          pdf_path?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          platform_invoice_id?: string | null
          platform_name?: string | null
          platform_status?: string | null
          previous_balance?: number | null
          purchase_order?: string | null
          raw_json?: Json | null
          raw_text?: string | null
          shared_at?: string | null
          source?: string | null
          status?: string | null
          subtotal?: number | null
          supply_address?: string | null
          supply_point_id?: string | null
          tax?: number | null
          total_amount?: number | null
          total_gbp?: number | null
          total_no_vat?: number | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          vat_no?: string | null
          vendor_address?: string | null
          vendor_phone?: string | null
          vendor_email?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_invoice_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "invoice_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_platform_integration_organization_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts_payable_invoice_line_item: {
        Row: {
          accounts_payable_invoice_id: string
          approval_notes: string | null
          approval_status:
            | Database["public"]["Enums"]["line_item_approval_status"]
            | null
          approved_at: string | null
          approver_amount: number | null
          approver_id: string | null
          approver_percentage: number | null
          assigned_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          item: string | null
          line_total: number | null
          location: string | null
          platform_account_id: string | null
          quantity: number | null
          raw_item_json: Json | null
          unit_price: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          accounts_payable_invoice_id: string
          approval_notes?: string | null
          approval_status?:
            | Database["public"]["Enums"]["line_item_approval_status"]
            | null
          approved_at?: string | null
          approver_amount?: number | null
          approver_id?: string | null
          approver_percentage?: number | null
          assigned_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          item?: string | null
          line_total?: number | null
          location?: string | null
          platform_account_id?: string | null
          quantity?: number | null
          raw_item_json?: Json | null
          unit_price?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          accounts_payable_invoice_id?: string
          approval_notes?: string | null
          approval_status?:
            | Database["public"]["Enums"]["line_item_approval_status"]
            | null
          approved_at?: string | null
          approver_amount?: number | null
          approver_id?: string | null
          approver_percentage?: number | null
          assigned_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          item?: string | null
          line_total?: number | null
          location?: string | null
          platform_account_id?: string | null
          quantity?: number | null
          raw_item_json?: Json | null
          unit_price?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_invoice_line__accounts_payable_invoice_id_fkey"
            columns: ["accounts_payable_invoice_id"]
            isOneToOne: false
            referencedRelation: "accounts_payable_invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_line_item_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_line_item_platform_account_id_fkey"
            columns: ["platform_account_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts_payable_invoice_rules_mapping: {
        Row: {
          chart_of_account_id: string | null
          created_at: string | null
          email: string
          folder_id: string | null
          id: string
          inbound_email_address: string | null
          inbound_email_id: string | null
          is_active: boolean | null
          location_id: string | null
          organization_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          chart_of_account_id?: string | null
          created_at?: string | null
          email: string
          folder_id?: string | null
          id?: string
          inbound_email_address?: string | null
          inbound_email_id?: string | null
          is_active?: boolean | null
          location_id?: string | null
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          chart_of_account_id?: string | null
          created_at?: string | null
          email?: string
          folder_id?: string | null
          id?: string
          inbound_email_address?: string | null
          inbound_email_id?: string | null
          is_active?: boolean | null
          location_id?: string | null
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_invoice_rules_mapping_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "invoice_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_rules_mapping_inbound_email_id_fkey"
            columns: ["inbound_email_id"]
            isOneToOne: false
            referencedRelation: "organization_inbound_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_rules_mapping_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_invoice_rules_mapping_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          apmt_appointment_cancellation_reason_id: number | null
          apmt_arrived_at: string | null
          apmt_booked_via_api: boolean | null
          apmt_cancelled_at: string | null
          apmt_completed_at: string | null
          apmt_confirmed_at: string | null
          apmt_created_at: string | null
          apmt_did_not_attend_at: string | null
          apmt_duration: number | null
          apmt_finish_time: string | null
          apmt_id: number | null
          apmt_in_surgery_at: string | null
          apmt_notes: string | null
          apmt_patient_id: number | null
          apmt_patient_image_url: string | null
          apmt_patient_name: string | null
          apmt_payment_plan_id: number | null
          apmt_pending_at: string | null
          apmt_practitioner_id: number | null
          apmt_practitioner_name: string | null
          apmt_practitioner_site_id: string | null
          apmt_reason: string | null
          apmt_start_time: string | null
          apmt_state: string | null
          apmt_treatment_description: string | null
          apmt_unique_id: string | null
          apmt_updated_at: string | null
          apmt_user_id: number | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          location_id: string | null
          organization_id: string
          region_id: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          apmt_appointment_cancellation_reason_id?: number | null
          apmt_arrived_at?: string | null
          apmt_booked_via_api?: boolean | null
          apmt_cancelled_at?: string | null
          apmt_completed_at?: string | null
          apmt_confirmed_at?: string | null
          apmt_created_at?: string | null
          apmt_did_not_attend_at?: string | null
          apmt_duration?: number | null
          apmt_finish_time?: string | null
          apmt_id?: number | null
          apmt_in_surgery_at?: string | null
          apmt_notes?: string | null
          apmt_patient_id?: number | null
          apmt_patient_image_url?: string | null
          apmt_patient_name?: string | null
          apmt_payment_plan_id?: number | null
          apmt_pending_at?: string | null
          apmt_practitioner_id?: number | null
          apmt_practitioner_name?: string | null
          apmt_practitioner_site_id?: string | null
          apmt_reason?: string | null
          apmt_start_time?: string | null
          apmt_state?: string | null
          apmt_treatment_description?: string | null
          apmt_unique_id?: string | null
          apmt_updated_at?: string | null
          apmt_user_id?: number | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          organization_id: string
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          apmt_appointment_cancellation_reason_id?: number | null
          apmt_arrived_at?: string | null
          apmt_booked_via_api?: boolean | null
          apmt_cancelled_at?: string | null
          apmt_completed_at?: string | null
          apmt_confirmed_at?: string | null
          apmt_created_at?: string | null
          apmt_did_not_attend_at?: string | null
          apmt_duration?: number | null
          apmt_finish_time?: string | null
          apmt_id?: number | null
          apmt_in_surgery_at?: string | null
          apmt_notes?: string | null
          apmt_patient_id?: number | null
          apmt_patient_image_url?: string | null
          apmt_patient_name?: string | null
          apmt_payment_plan_id?: number | null
          apmt_pending_at?: string | null
          apmt_practitioner_id?: number | null
          apmt_practitioner_name?: string | null
          apmt_practitioner_site_id?: string | null
          apmt_reason?: string | null
          apmt_start_time?: string | null
          apmt_state?: string | null
          apmt_treatment_description?: string | null
          apmt_unique_id?: string | null
          apmt_updated_at?: string | null
          apmt_user_id?: number | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          organization_id?: string
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      category_range_map: {
        Row: {
          category_range_id: number
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          mapping_location_id: string | null
          organization_id: string
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
        }
        Insert: {
          category_range_id: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          mapping_location_id?: string | null
          organization_id: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
        }
        Update: {
          category_range_id?: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          mapping_location_id?: string | null
          organization_id?: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "category_range_map_category_range_id_fkey"
            columns: ["category_range_id"]
            isOneToOne: false
            referencedRelation: "category_range_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_range_map_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_range_map_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_range_map_platform_integration_organization_id_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      category_range_master: {
        Row: {
          code: string | null
          id: number
          name: string | null
          range_group: string | null
          range_order: number | null
          range_sub_group: string | null
        }
        Insert: {
          code?: string | null
          id: number
          name?: string | null
          range_group?: string | null
          range_order?: number | null
          range_sub_group?: string | null
        }
        Update: {
          code?: string | null
          id?: number
          name?: string | null
          range_group?: string | null
          range_order?: number | null
          range_sub_group?: string | null
        }
        Relationships: []
      }
      category_wish_list: {
        Row: {
          category_wish_list_master_id: number
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          mapping_location_id: string | null
          organization_id: string
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
        }
        Insert: {
          category_wish_list_master_id: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          mapping_location_id?: string | null
          organization_id: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
        }
        Update: {
          category_wish_list_master_id?: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          mapping_location_id?: string | null
          organization_id?: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "category_wish_list_category_wish_list_master_id_fkey"
            columns: ["category_wish_list_master_id"]
            isOneToOne: false
            referencedRelation: "category_wish_list_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_wish_list_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_wish_list_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_wish_list_platform_integration_organization_id_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      category_wish_list_master: {
        Row: {
          category_wish_list: string | null
          id: number
          name: string | null
          range_order: number | null
          sector_id: number
        }
        Insert: {
          category_wish_list?: string | null
          id: number
          name?: string | null
          range_order?: number | null
          sector_id?: number
        }
        Update: {
          category_wish_list?: string | null
          id?: number
          name?: string | null
          range_order?: number | null
          sector_id?: number
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      general_notification: {
        Row: {
          associate_id: string | null
          created_at: string | null
          data: Json | null
          id: string
          message: string | null
          module_type: string | null
          notification_type: string
          organization_id: string | null
          read_at: string | null
          reason: string | null
          title: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          associate_id?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          message?: string | null
          module_type?: string | null
          notification_type?: string
          organization_id?: string | null
          read_at?: string | null
          reason?: string | null
          title: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          associate_id?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          message?: string | null
          module_type?: string | null
          notification_type?: string
          organization_id?: string | null
          read_at?: string | null
          reason?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      google_ads_campaigns: {
        Row: {
          average_cpc: number
          campaign_id: string
          campaign_name: string
          campaign_status: string
          campaign_type: string
          clicks: number
          conversions: number
          cost: number
          cost_per_conversion: number
          created_at: string
          ctr: number
          id: string
          impressions: number
          organization_id: string
          report_date: string
          updated_at: string
        }
        Insert: {
          average_cpc?: number
          campaign_id: string
          campaign_name: string
          campaign_status?: string
          campaign_type?: string
          clicks?: number
          conversions?: number
          cost?: number
          cost_per_conversion?: number
          created_at?: string
          ctr?: number
          id?: string
          impressions?: number
          organization_id: string
          report_date: string
          updated_at?: string
        }
        Update: {
          average_cpc?: number
          campaign_id?: string
          campaign_name?: string
          campaign_status?: string
          campaign_type?: string
          clicks?: number
          conversions?: number
          cost?: number
          cost_per_conversion?: number
          created_at?: string
          ctr?: number
          id?: string
          impressions?: number
          organization_id?: string
          report_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_ads_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_account: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          group_account_master_id: number
          id: string
          mapping_location_id: string | null
          organization_id: string
          platform_integration_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          group_account_master_id: number
          id?: string
          mapping_location_id?: string | null
          organization_id: string
          platform_integration_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          group_account_master_id?: number
          id?: string
          mapping_location_id?: string | null
          organization_id?: string
          platform_integration_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_account_group_account_master_id_fkey"
            columns: ["group_account_master_id"]
            isOneToOne: false
            referencedRelation: "group_account_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_account_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_account_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_account_master: {
        Row: {
          description: string | null
          group_code: string
          group_type: number
          id: number
          name: string
          range_order: number | null
          sector_id: number | null
        }
        Insert: {
          description?: string | null
          group_code: string
          group_type?: number
          id: number
          name: string
          range_order?: number | null
          sector_id?: number | null
        }
        Update: {
          description?: string | null
          group_code?: string
          group_type?: number
          id?: number
          name?: string
          range_order?: number | null
          sector_id?: number | null
        }
        Relationships: []
      }
      inbound_email_attachments: {
        Row: {
          created_at: string | null
          download_url: string | null
          filename: string | null
          id: string
          inbound_email_id: string
          invoice_id: string | null
          is_invoice_pdf: boolean | null
          mime_type: string | null
          size: number | null
          stored_path: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          download_url?: string | null
          filename?: string | null
          id?: string
          inbound_email_id: string
          invoice_id?: string | null
          is_invoice_pdf?: boolean | null
          mime_type?: string | null
          size?: number | null
          stored_path?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          download_url?: string | null
          filename?: string | null
          id?: string
          inbound_email_id?: string
          invoice_id?: string | null
          is_invoice_pdf?: boolean | null
          mime_type?: string | null
          size?: number | null
          stored_path?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_email_attachments_inbound_email_id_fkey"
            columns: ["inbound_email_id"]
            isOneToOne: false
            referencedRelation: "inbound_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_email_logs: {
        Row: {
          action: string
          created_at: string | null
          error_code: string | null
          error_message: string | null
          id: string
          inbound_email_id: string | null
          invoice_id: string | null
          ip_address: string | null
          metadata: Json | null
          organization_id: string | null
          request_payload: Json | null
          response_payload: Json | null
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          inbound_email_id?: string | null
          invoice_id?: string | null
          ip_address?: string | null
          metadata?: Json | null
          organization_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          inbound_email_id?: string | null
          invoice_id?: string | null
          ip_address?: string | null
          metadata?: Json | null
          organization_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_email_logs_inbound_email_id_fkey"
            columns: ["inbound_email_id"]
            isOneToOne: false
            referencedRelation: "inbound_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_email_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_emails: {
        Row: {
          created_at: string | null
          error_message: string | null
          from_email: string | null
          from_name: string | null
          has_attachments: boolean | null
          html_body: string | null
          id: string
          invoice_id: string | null
          location_id: string | null
          message_id: string | null
          organization_id: string | null
          raw_payload: Json | null
          received_at: string | null
          status: string | null
          subject: string | null
          text_body: string | null
          thread_id: string | null
          to_email: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          from_email?: string | null
          from_name?: string | null
          has_attachments?: boolean | null
          html_body?: string | null
          id?: string
          invoice_id?: string | null
          location_id?: string | null
          message_id?: string | null
          organization_id?: string | null
          raw_payload?: Json | null
          received_at?: string | null
          status?: string | null
          subject?: string | null
          text_body?: string | null
          thread_id?: string | null
          to_email?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          from_email?: string | null
          from_name?: string | null
          has_attachments?: boolean | null
          html_body?: string | null
          id?: string
          invoice_id?: string | null
          location_id?: string | null
          message_id?: string | null
          organization_id?: string | null
          raw_payload?: Json | null
          received_at?: string | null
          status?: string | null
          subject?: string | null
          text_body?: string | null
          thread_id?: string | null
          to_email?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_emails_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "accounts_payable_invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_emails_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      industry_benchmarks: {
        Row: {
          benchmark_high: number | null
          benchmark_low: number | null
          benchmark_value: number
          created_at: string | null
          effective_from: string
          effective_to: string | null
          id: string
          industry: string
          is_active: boolean | null
          metric_category: string
          metric_name: string
          practice_size: string | null
          region: string | null
          source: string | null
          updated_at: string | null
        }
        Insert: {
          benchmark_high?: number | null
          benchmark_low?: number | null
          benchmark_value: number
          created_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          industry?: string
          is_active?: boolean | null
          metric_category: string
          metric_name: string
          practice_size?: string | null
          region?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          benchmark_high?: number | null
          benchmark_low?: number | null
          benchmark_value?: number
          created_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          industry?: string
          is_active?: boolean | null
          metric_category?: string
          metric_name?: string
          practice_size?: string | null
          region?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      integration_sync_entities: {
        Row: {
          created_at: string | null
          entity_alias: string
          entity_description: string | null
          entity_label: string
          id: string
          integration_id: string
          is_available: boolean | null
          is_sync: boolean | null
          last_synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          entity_alias: string
          entity_description?: string | null
          entity_label: string
          id?: string
          integration_id: string
          is_available?: boolean | null
          is_sync?: boolean | null
          last_synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          entity_alias?: string
          entity_description?: string | null
          entity_label?: string
          id?: string
          integration_id?: string
          is_available?: boolean | null
          is_sync?: boolean | null
          last_synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_entities_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          api_endpoints: string | null
          api_key: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          integration_description: string | null
          integration_name: string
          is_connected: boolean | null
          organization_id: string
          secret_key_id_available: string | null
          sync_at: string | null
          sync_frequency: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          api_endpoints?: string | null
          api_key?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          integration_description?: string | null
          integration_name: string
          is_connected?: boolean | null
          organization_id: string
          secret_key_id_available?: string | null
          sync_at?: string | null
          sync_frequency?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          api_endpoints?: string | null
          api_key?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          integration_description?: string | null
          integration_name?: string
          is_connected?: boolean | null
          organization_id?: string
          secret_key_id_available?: string | null
          sync_at?: string | null
          sync_frequency?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_folders: {
        Row: {
          created_at: string | null
          id: string
          location_id: string | null
          name: string
          organization_id: string | null
          parent_id: string | null
          type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          location_id?: string | null
          name: string
          organization_id?: string | null
          parent_id?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string | null
          parent_id?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_folders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "invoice_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_tag_assignments: {
        Row: {
          created_at: string | null
          id: string
          invoice_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_id: string
          tag_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_tag_assignments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "accounts_payable_invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "invoice_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_tags: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          location_id: string | null
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_tags_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      iplicit_account_balances: {
        Row: {
          account_code: string
          account_name: string | null
          account_type: string | null
          as_of_date: string | null
          balance: number
          connection_id: string
          created_at: string
          currency: string | null
          id: string
          organization_id: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          account_code: string
          account_name?: string | null
          account_type?: string | null
          as_of_date?: string | null
          balance?: number
          connection_id: string
          created_at?: string
          currency?: string | null
          id?: string
          organization_id: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          account_code?: string
          account_name?: string | null
          account_type?: string | null
          as_of_date?: string | null
          balance?: number
          connection_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          organization_id?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iplicit_account_balances_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "accounting_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iplicit_account_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      iplicit_bank_transactions: {
        Row: {
          amount: number | null
          bank_account_name: string | null
          bank_account_ref: string | null
          connection_id: string
          counterparty_name: string | null
          counterparty_ref: string | null
          created_at: string | null
          currency_code: string | null
          description: string | null
          external_id: string
          id: string
          narrative: string | null
          organization_id: string
          reference: string | null
          synced_at: string | null
          transaction_date: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          bank_account_name?: string | null
          bank_account_ref?: string | null
          connection_id: string
          counterparty_name?: string | null
          counterparty_ref?: string | null
          created_at?: string | null
          currency_code?: string | null
          description?: string | null
          external_id: string
          id?: string
          narrative?: string | null
          organization_id: string
          reference?: string | null
          synced_at?: string | null
          transaction_date?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          bank_account_name?: string | null
          bank_account_ref?: string | null
          connection_id?: string
          counterparty_name?: string | null
          counterparty_ref?: string | null
          created_at?: string | null
          currency_code?: string | null
          description?: string | null
          external_id?: string
          id?: string
          narrative?: string | null
          organization_id?: string
          reference?: string | null
          synced_at?: string | null
          transaction_date?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "iplicit_bank_transactions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iplicit_bank_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      iplicit_gl_entries: {
        Row: {
          account_code: string | null
          account_id: string | null
          account_name: string | null
          connection_id: string
          counterparty_name: string | null
          counterparty_ref: string | null
          created_at: string | null
          credit_amount: number | null
          currency_code: string | null
          debit_amount: number | null
          description: string | null
          doc_class: string | null
          doc_date: string | null
          entry_date: string | null
          external_id: string
          id: string
          line_description: string | null
          line_number: number | null
          narrative: string | null
          net_amount: number | null
          organization_id: string
          source_ref: string | null
          source_type: string
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          account_code?: string | null
          account_id?: string | null
          account_name?: string | null
          connection_id: string
          counterparty_name?: string | null
          counterparty_ref?: string | null
          created_at?: string | null
          credit_amount?: number | null
          currency_code?: string | null
          debit_amount?: number | null
          description?: string | null
          doc_class?: string | null
          doc_date?: string | null
          entry_date?: string | null
          external_id: string
          id?: string
          line_description?: string | null
          line_number?: number | null
          narrative?: string | null
          net_amount?: number | null
          organization_id: string
          source_ref?: string | null
          source_type: string
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          account_code?: string | null
          account_id?: string | null
          account_name?: string | null
          connection_id?: string
          counterparty_name?: string | null
          counterparty_ref?: string | null
          created_at?: string | null
          credit_amount?: number | null
          currency_code?: string | null
          debit_amount?: number | null
          description?: string | null
          doc_class?: string | null
          doc_date?: string | null
          entry_date?: string | null
          external_id?: string
          id?: string
          line_description?: string | null
          line_number?: number | null
          narrative?: string | null
          net_amount?: number | null
          organization_id?: string
          source_ref?: string | null
          source_type?: string
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "iplicit_gl_entries_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iplicit_gl_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      iplicit_invoices: {
        Row: {
          amount: number
          connection_id: string
          created_at: string
          currency: string | null
          customer_name: string | null
          due_date: string | null
          external_id: string
          id: string
          invoice_number: string | null
          issue_date: string | null
          organization_id: string
          paid_date: string | null
          status: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          amount?: number
          connection_id: string
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          due_date?: string | null
          external_id: string
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          organization_id: string
          paid_date?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          connection_id?: string
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          due_date?: string | null
          external_id?: string
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          organization_id?: string
          paid_date?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iplicit_invoices_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "accounting_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iplicit_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      iplicit_sync_logs: {
        Row: {
          completed_at: string | null
          connection_id: string
          created_at: string
          error_message: string | null
          id: string
          organization_id: string
          records_synced: number | null
          retry_count: number | null
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          completed_at?: string | null
          connection_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id: string
          records_synced?: number | null
          retry_count?: number | null
          started_at?: string
          status?: string
          sync_type?: string
        }
        Update: {
          completed_at?: string | null
          connection_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          records_synced?: number | null
          retry_count?: number | null
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "iplicit_sync_logs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "accounting_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iplicit_sync_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      iplicit_transactions: {
        Row: {
          account_code: string | null
          account_name: string | null
          amount: number
          connection_id: string
          created_at: string
          currency: string | null
          description: string | null
          external_id: string
          id: string
          organization_id: string
          reference: string | null
          synced_at: string
          transaction_date: string | null
          transaction_type: string | null
          updated_at: string
        }
        Insert: {
          account_code?: string | null
          account_name?: string | null
          amount?: number
          connection_id: string
          created_at?: string
          currency?: string | null
          description?: string | null
          external_id: string
          id?: string
          organization_id: string
          reference?: string | null
          synced_at?: string
          transaction_date?: string | null
          transaction_type?: string | null
          updated_at?: string
        }
        Update: {
          account_code?: string | null
          account_name?: string | null
          amount?: number
          connection_id?: string
          created_at?: string
          currency?: string | null
          description?: string | null
          external_id?: string
          id?: string
          organization_id?: string
          reference?: string | null
          synced_at?: string
          transaction_date?: string | null
          transaction_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iplicit_transactions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "accounting_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iplicit_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_category_mapping: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          lease_category: string
          lease_sub_category: string | null
          match_keywords: string[] | null
          organization_id: string | null
          priority: number | null
          updated_at: string | null
          xero_account_code: string
          xero_account_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          lease_category: string
          lease_sub_category?: string | null
          match_keywords?: string[] | null
          organization_id?: string | null
          priority?: number | null
          updated_at?: string | null
          xero_account_code: string
          xero_account_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          lease_category?: string
          lease_sub_category?: string | null
          match_keywords?: string[] | null
          organization_id?: string | null
          priority?: number | null
          updated_at?: string | null
          xero_account_code?: string
          xero_account_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lease_category_mapping_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_master: {
        Row: {
          auto_renew: boolean | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          has_renewal_option: boolean | null
          id: string
          lease_category: string
          lease_description: string | null
          lease_end_date: string
          lease_name: string
          lease_reference: string | null
          lease_start_date: string
          lease_sub_category: string | null
          location_id: string | null
          location_name: string | null
          monthly_rent: number
          next_review_date: string | null
          notice_period_months: number | null
          organization_id: string
          payment_frequency: string | null
          renewal_terms: string | null
          status: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
          xero_account_code: string | null
          xero_account_codes: string[] | null
          xero_contact_id: string | null
          xero_contact_name: string | null
        }
        Insert: {
          auto_renew?: boolean | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          has_renewal_option?: boolean | null
          id?: string
          lease_category: string
          lease_description?: string | null
          lease_end_date: string
          lease_name: string
          lease_reference?: string | null
          lease_start_date: string
          lease_sub_category?: string | null
          location_id?: string | null
          location_name?: string | null
          monthly_rent?: number
          next_review_date?: string | null
          notice_period_months?: number | null
          organization_id: string
          payment_frequency?: string | null
          renewal_terms?: string | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          xero_account_code?: string | null
          xero_account_codes?: string[] | null
          xero_contact_id?: string | null
          xero_contact_name?: string | null
        }
        Update: {
          auto_renew?: boolean | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          has_renewal_option?: boolean | null
          id?: string
          lease_category?: string
          lease_description?: string | null
          lease_end_date?: string
          lease_name?: string
          lease_reference?: string | null
          lease_start_date?: string
          lease_sub_category?: string | null
          location_id?: string | null
          location_name?: string | null
          monthly_rent?: number
          next_review_date?: string | null
          notice_period_months?: number | null
          organization_id?: string
          payment_frequency?: string | null
          renewal_terms?: string | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          xero_account_code?: string | null
          xero_account_codes?: string[] | null
          xero_contact_id?: string | null
          xero_contact_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lease_master_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_master_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      nhs_claims: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          location_id: string | null
          nc_approval_date: string | null
          nc_awarded_uda: number | null
          nc_claim_status: string | null
          nc_continuation_part_number: string | null
          nc_contract_id: number | null
          nc_created_at: string | null
          nc_dentist_charge: number | null
          nc_expected_uda: number | null
          nc_id: number | null
          nc_ni_dentist_fee: number | null
          nc_ni_patient_fee: number | null
          nc_nhs_updated_at: string | null
          nc_ortho: boolean | null
          nc_patient_charge: number | null
          nc_patient_id: number | null
          nc_practitioner_id: number | null
          nc_scot_amount_authorised: number | null
          nc_scot_amount_expected: number | null
          nc_sequence_number: string | null
          nc_site_id: string | null
          nc_status_comments: string | null
          nc_submitted_date: string | null
          nc_treatment_plan_id: number | null
          nc_uda_band: string | null
          nc_updated_at: string | null
          organization_id: string
          region_id: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          location_id?: string | null
          nc_approval_date?: string | null
          nc_awarded_uda?: number | null
          nc_claim_status?: string | null
          nc_continuation_part_number?: string | null
          nc_contract_id?: number | null
          nc_created_at?: string | null
          nc_dentist_charge?: number | null
          nc_expected_uda?: number | null
          nc_id?: number | null
          nc_ni_dentist_fee?: number | null
          nc_ni_patient_fee?: number | null
          nc_nhs_updated_at?: string | null
          nc_ortho?: boolean | null
          nc_patient_charge?: number | null
          nc_patient_id?: number | null
          nc_practitioner_id?: number | null
          nc_scot_amount_authorised?: number | null
          nc_scot_amount_expected?: number | null
          nc_sequence_number?: string | null
          nc_site_id?: string | null
          nc_status_comments?: string | null
          nc_submitted_date?: string | null
          nc_treatment_plan_id?: number | null
          nc_uda_band?: string | null
          nc_updated_at?: string | null
          organization_id: string
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          location_id?: string | null
          nc_approval_date?: string | null
          nc_awarded_uda?: number | null
          nc_claim_status?: string | null
          nc_continuation_part_number?: string | null
          nc_contract_id?: number | null
          nc_created_at?: string | null
          nc_dentist_charge?: number | null
          nc_expected_uda?: number | null
          nc_id?: number | null
          nc_ni_dentist_fee?: number | null
          nc_ni_patient_fee?: number | null
          nc_nhs_updated_at?: string | null
          nc_ortho?: boolean | null
          nc_patient_charge?: number | null
          nc_patient_id?: number | null
          nc_practitioner_id?: number | null
          nc_scot_amount_authorised?: number | null
          nc_scot_amount_expected?: number | null
          nc_sequence_number?: string | null
          nc_site_id?: string | null
          nc_status_comments?: string | null
          nc_submitted_date?: string | null
          nc_treatment_plan_id?: number | null
          nc_uda_band?: string | null
          nc_updated_at?: string | null
          organization_id?: string
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nhs_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nhs_claims_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nhs_claims_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          organization_id: string
          read_at: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          title: string
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          organization_id: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          title: string
          type?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          organization_id?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          title?: string
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_inbound_emails: {
        Row: {
          created_at: string | null
          email_type: string
          id: string
          inbound_created: number | null
          inbound_email_address: string
          inbound_meta: Json | null
          inbound_provider_id: string | null
          location_id: string | null
          organization_id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email_type?: string
          id?: string
          inbound_created?: number | null
          inbound_email_address: string
          inbound_meta?: Json | null
          inbound_provider_id?: string | null
          location_id?: string | null
          organization_id: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email_type?: string
          id?: string
          inbound_created?: number | null
          inbound_email_address?: string
          inbound_meta?: Json | null
          inbound_provider_id?: string | null
          location_id?: string | null
          organization_id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_inbound_emails_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_inbound_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          created_at: string
          currency: string | null
          date_format: string | null
          financial_month_start: number | null
          fiscal_year_start: string | null
          id: string
          notifications_enabled: boolean | null
          onboarding_completed: boolean | null
          organization_id: string
          show_debt_and_deals: boolean
          show_decimals: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          date_format?: string | null
          financial_month_start?: number | null
          fiscal_year_start?: string | null
          id?: string
          notifications_enabled?: boolean | null
          onboarding_completed?: boolean | null
          organization_id: string
          show_debt_and_deals?: boolean
          show_decimals?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          date_format?: string | null
          financial_month_start?: number | null
          fiscal_year_start?: string | null
          id?: string
          notifications_enabled?: boolean | null
          onboarding_completed?: boolean | null
          organization_id?: string
          show_debt_and_deals?: boolean
          show_decimals?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          lab_fees: string | null
          logo_url: string | null
          membership_income: string | null
          name: string
          nhs_income: string | null
          operating_lease: string | null
          phone: string | null
          private_income: string | null
          staff_costs: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          lab_fees?: string | null
          logo_url?: string | null
          membership_income?: string | null
          name: string
          nhs_income?: string | null
          operating_lease?: string | null
          phone?: string | null
          private_income?: string | null
          staff_costs?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          lab_fees?: string | null
          logo_url?: string | null
          membership_income?: string | null
          name?: string
          nhs_income?: string | null
          operating_lease?: string | null
          phone?: string | null
          private_income?: string | null
          staff_costs?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      patients: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          is_active: boolean | null
          location_id: string | null
          organization_id: string
          pt_account_id: string | null
          pt_address_line_1: string | null
          pt_address_line_2: string | null
          pt_address_line_3: string | null
          pt_county: string | null
          pt_created_at: string | null
          pt_dentist_id: number | null
          pt_dentist_recall_date: string | null
          pt_dentist_recall_interval: number | null
          pt_dob: string | null
          pt_doctor_id: number | null
          pt_email: string | null
          pt_family_id: number | null
          pt_first_name: string | null
          pt_gender: string | null
          pt_id: number | null
          pt_image_url: string | null
          pt_is_student: boolean | null
          pt_last_name: string | null
          pt_middle_name: string | null
          pt_mobile_phone: string | null
          pt_payment_plan_id: number | null
          pt_payment_plan_subscription_id: string | null
          pt_payment_plan_subscription_status: string | null
          pt_postcode: string | null
          pt_region: string | null
          pt_site_id: string | null
          pt_title: string | null
          pt_town: string | null
          pt_unique_id: string | null
          pt_updated_at: string | null
          region_id: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          organization_id: string
          pt_account_id?: string | null
          pt_address_line_1?: string | null
          pt_address_line_2?: string | null
          pt_address_line_3?: string | null
          pt_county?: string | null
          pt_created_at?: string | null
          pt_dentist_id?: number | null
          pt_dentist_recall_date?: string | null
          pt_dentist_recall_interval?: number | null
          pt_dob?: string | null
          pt_doctor_id?: number | null
          pt_email?: string | null
          pt_family_id?: number | null
          pt_first_name?: string | null
          pt_gender?: string | null
          pt_id?: number | null
          pt_image_url?: string | null
          pt_is_student?: boolean | null
          pt_last_name?: string | null
          pt_middle_name?: string | null
          pt_mobile_phone?: string | null
          pt_payment_plan_id?: number | null
          pt_payment_plan_subscription_id?: string | null
          pt_payment_plan_subscription_status?: string | null
          pt_postcode?: string | null
          pt_region?: string | null
          pt_site_id?: string | null
          pt_title?: string | null
          pt_town?: string | null
          pt_unique_id?: string | null
          pt_updated_at?: string | null
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          organization_id?: string
          pt_account_id?: string | null
          pt_address_line_1?: string | null
          pt_address_line_2?: string | null
          pt_address_line_3?: string | null
          pt_county?: string | null
          pt_created_at?: string | null
          pt_dentist_id?: number | null
          pt_dentist_recall_date?: string | null
          pt_dentist_recall_interval?: number | null
          pt_dob?: string | null
          pt_doctor_id?: number | null
          pt_email?: string | null
          pt_family_id?: number | null
          pt_first_name?: string | null
          pt_gender?: string | null
          pt_id?: number | null
          pt_image_url?: string | null
          pt_is_student?: boolean | null
          pt_last_name?: string | null
          pt_middle_name?: string | null
          pt_mobile_phone?: string | null
          pt_payment_plan_id?: number | null
          pt_payment_plan_subscription_id?: string | null
          pt_payment_plan_subscription_status?: string | null
          pt_postcode?: string | null
          pt_region?: string | null
          pt_site_id?: string | null
          pt_title?: string | null
          pt_town?: string | null
          pt_unique_id?: string | null
          pt_updated_at?: string | null
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_plans: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          location_id: string | null
          organization_id: string
          pp_colour: string | null
          pp_created_at: string | null
          pp_dentist_recall_interval: number | null
          pp_emergency_duration: number | null
          pp_exam_appointments_included: number | null
          pp_exam_duration: number | null
          pp_exam_scale_and_polish_duration: number | null
          pp_hygiene_appointments_included: number | null
          pp_hygienist_recall_interval: number | null
          pp_id: number | null
          pp_is_active: boolean | null
          pp_monthly_memberhsip_fee: number | null
          pp_name: string | null
          pp_patient_friendly_name: string | null
          pp_recall_method: string | null
          pp_scale_and_polish_duration: number | null
          pp_site_id: string | null
          region_id: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          organization_id: string
          pp_colour?: string | null
          pp_created_at?: string | null
          pp_dentist_recall_interval?: number | null
          pp_emergency_duration?: number | null
          pp_exam_appointments_included?: number | null
          pp_exam_duration?: number | null
          pp_exam_scale_and_polish_duration?: number | null
          pp_hygiene_appointments_included?: number | null
          pp_hygienist_recall_interval?: number | null
          pp_id?: number | null
          pp_is_active?: boolean | null
          pp_monthly_memberhsip_fee?: number | null
          pp_name?: string | null
          pp_patient_friendly_name?: string | null
          pp_recall_method?: string | null
          pp_scale_and_polish_duration?: number | null
          pp_site_id?: string | null
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          organization_id?: string
          pp_colour?: string | null
          pp_created_at?: string | null
          pp_dentist_recall_interval?: number | null
          pp_emergency_duration?: number | null
          pp_exam_appointments_included?: number | null
          pp_exam_duration?: number | null
          pp_exam_scale_and_polish_duration?: number | null
          pp_hygiene_appointments_included?: number | null
          pp_hygienist_recall_interval?: number | null
          pp_id?: number | null
          pp_is_active?: boolean | null
          pp_monthly_memberhsip_fee?: number | null
          pp_name?: string | null
          pp_patient_friendly_name?: string | null
          pp_recall_method?: string | null
          pp_scale_and_polish_duration?: number | null
          pp_site_id?: string | null
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_plans_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_plans_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      planned_daily_production: {
        Row: {
          average_daily_production: number
          created_at: string | null
          created_by: string | null
          created_by_email: string | null
          date_range_end: string
          date_range_start: string
          id: string
          notes: string | null
          organization_id: string
          planned_associate_net_pay: number | null
          planned_cost_of_labs: number | null
          planned_materials: number | null
          planned_practice_pl: number | null
          planned_total_production: number | null
          planning_month: string
          provider_id: string
          updated_at: string | null
          user_id: string
          working_days: number | null
        }
        Insert: {
          average_daily_production?: number
          created_at?: string | null
          created_by?: string | null
          created_by_email?: string | null
          date_range_end: string
          date_range_start: string
          id?: string
          notes?: string | null
          organization_id: string
          planned_associate_net_pay?: number | null
          planned_cost_of_labs?: number | null
          planned_materials?: number | null
          planned_practice_pl?: number | null
          planned_total_production?: number | null
          planning_month: string
          provider_id: string
          updated_at?: string | null
          user_id: string
          working_days?: number | null
        }
        Update: {
          average_daily_production?: number
          created_at?: string | null
          created_by?: string | null
          created_by_email?: string | null
          date_range_end?: string
          date_range_start?: string
          id?: string
          notes?: string | null
          organization_id?: string
          planned_associate_net_pay?: number | null
          planned_cost_of_labs?: number | null
          planned_materials?: number | null
          planned_practice_pl?: number | null
          planned_total_production?: number | null
          planning_month?: string
          provider_id?: string
          updated_at?: string | null
          user_id?: string
          working_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "planned_daily_production_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_daily_production_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_bank_transactions: {
        Row: {
          bank_account_id: string | null
          bank_account_name: string | null
          bank_transaction_id: string | null
          contact_id: string | null
          contact_name: string | null
          created_at: string | null
          currency_code: string | null
          has_attachments: boolean | null
          id: string
          is_reconciled: boolean | null
          line_amount_types: string | null
          organization_id: string
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
          status: string | null
          sub_total: number | null
          total: number | null
          total_tax: number | null
          transaction_date: string | null
          type: string | null
          updated_at: string | null
          updated_date_utc: string | null
        }
        Insert: {
          bank_account_id?: string | null
          bank_account_name?: string | null
          bank_transaction_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          currency_code?: string | null
          has_attachments?: boolean | null
          id?: string
          is_reconciled?: boolean | null
          line_amount_types?: string | null
          organization_id: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          status?: string | null
          sub_total?: number | null
          total?: number | null
          total_tax?: number | null
          transaction_date?: string | null
          type?: string | null
          updated_at?: string | null
          updated_date_utc?: string | null
        }
        Update: {
          bank_account_id?: string | null
          bank_account_name?: string | null
          bank_transaction_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          currency_code?: string | null
          has_attachments?: boolean | null
          id?: string
          is_reconciled?: boolean | null
          line_amount_types?: string | null
          organization_id?: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          status?: string | null
          sub_total?: number | null
          total?: number | null
          total_tax?: number | null
          transaction_date?: string | null
          type?: string | null
          updated_at?: string | null
          updated_date_utc?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_bank_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_bank_transactions_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_bank_transactions_platform_integration_organizati_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_credit_note_allocations: {
        Row: {
          allocation_amount: number | null
          allocation_date: string
          allocation_id: string | null
          created_at: string | null
          credit_note_id: string | null
          id: string
          invoice_id: string | null
          invoice_number: string | null
          organization_id: string
          platform_credit_note_id: string | null
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
          updated_at: string | null
        }
        Insert: {
          allocation_amount?: number | null
          allocation_date: string
          allocation_id?: string | null
          created_at?: string | null
          credit_note_id?: string | null
          id?: string
          invoice_id?: string | null
          invoice_number?: string | null
          organization_id: string
          platform_credit_note_id?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          updated_at?: string | null
        }
        Update: {
          allocation_amount?: number | null
          allocation_date?: string
          allocation_id?: string | null
          created_at?: string | null
          credit_note_id?: string | null
          id?: string
          invoice_id?: string | null
          invoice_number?: string | null
          organization_id?: string
          platform_credit_note_id?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_credit_note_allocati_platform_integration_organiz_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_credit_note_allocations_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "platform_credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_credit_note_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_credit_note_allocations_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_credit_notes: {
        Row: {
          account_type: string
          allocation_amount: number | null
          allocation_date: string | null
          allocation_id: string | null
          contact_id: string | null
          contact_name: string | null
          created_at: string | null
          credit_note_date: string | null
          credit_note_id: string | null
          credit_note_number: string
          credit_note_reference: string | null
          currency_code: string | null
          currency_rate: number | null
          fully_paid_on_date: string | null
          id: string
          invoice_id: string | null
          invoice_number: string | null
          organization_id: string
          payment_amount: number | null
          payment_date: string | null
          payment_id: string | null
          payment_reference: string | null
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
          remaining_credit: number | null
          status: string | null
          sub_total: number | null
          total: number | null
          total_tax: number | null
          updated_at: string | null
          updated_date_utc: string | null
        }
        Insert: {
          account_type: string
          allocation_amount?: number | null
          allocation_date?: string | null
          allocation_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          credit_note_date?: string | null
          credit_note_id?: string | null
          credit_note_number: string
          credit_note_reference?: string | null
          currency_code?: string | null
          currency_rate?: number | null
          fully_paid_on_date?: string | null
          id?: string
          invoice_id?: string | null
          invoice_number?: string | null
          organization_id: string
          payment_amount?: number | null
          payment_date?: string | null
          payment_id?: string | null
          payment_reference?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          remaining_credit?: number | null
          status?: string | null
          sub_total?: number | null
          total?: number | null
          total_tax?: number | null
          updated_at?: string | null
          updated_date_utc?: string | null
        }
        Update: {
          account_type?: string
          allocation_amount?: number | null
          allocation_date?: string | null
          allocation_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          credit_note_date?: string | null
          credit_note_id?: string | null
          credit_note_number?: string
          credit_note_reference?: string | null
          currency_code?: string | null
          currency_rate?: number | null
          fully_paid_on_date?: string | null
          id?: string
          invoice_id?: string | null
          invoice_number?: string | null
          organization_id?: string
          payment_amount?: number | null
          payment_date?: string | null
          payment_id?: string | null
          payment_reference?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          remaining_credit?: number | null
          status?: string | null
          sub_total?: number | null
          total?: number | null
          total_tax?: number | null
          updated_at?: string | null
          updated_date_utc?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_credit_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_credit_notes_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_credit_notes_platform_integration_organization_id_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_integration_chart_of_accounts: {
        Row: {
          coa_account_code: string | null
          coa_account_id: string
          coa_account_name: string
          coa_account_sub_type: string | null
          coa_account_type: string
          coa_as_on_date_balance: string | null
          coa_bank_account_type: string | null
          coa_classification: string | null
          coa_current_balance: number | null
          coa_description: string | null
          coa_is_active: boolean | null
          coa_is_ap_account: boolean | null
          coa_is_ar_account: boolean | null
          coa_opening_balance: number | null
          coa_reporting_code: string | null
          coa_reporting_name: string | null
          coa_sub_account: boolean | null
          coa_sync_token: string | null
          coa_system_account: string | null
          coa_tax_type: string | null
          coa_updated_date_utc: string | null
          created_at: string | null
          id: string
          organization_id: string
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
          platform_name: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          coa_account_code?: string | null
          coa_account_id: string
          coa_account_name: string
          coa_account_sub_type?: string | null
          coa_account_type: string
          coa_as_on_date_balance?: string | null
          coa_bank_account_type?: string | null
          coa_classification?: string | null
          coa_current_balance?: number | null
          coa_description?: string | null
          coa_is_active?: boolean | null
          coa_is_ap_account?: boolean | null
          coa_is_ar_account?: boolean | null
          coa_opening_balance?: number | null
          coa_reporting_code?: string | null
          coa_reporting_name?: string | null
          coa_sub_account?: boolean | null
          coa_sync_token?: string | null
          coa_system_account?: string | null
          coa_tax_type?: string | null
          coa_updated_date_utc?: string | null
          created_at?: string | null
          id?: string
          organization_id: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          platform_name: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          coa_account_code?: string | null
          coa_account_id?: string
          coa_account_name?: string
          coa_account_sub_type?: string | null
          coa_account_type?: string
          coa_as_on_date_balance?: string | null
          coa_bank_account_type?: string | null
          coa_classification?: string | null
          coa_current_balance?: number | null
          coa_description?: string | null
          coa_is_active?: boolean | null
          coa_is_ap_account?: boolean | null
          coa_is_ar_account?: boolean | null
          coa_opening_balance?: number | null
          coa_reporting_code?: string | null
          coa_reporting_name?: string | null
          coa_sub_account?: boolean | null
          coa_sync_token?: string | null
          coa_system_account?: string | null
          coa_tax_type?: string | null
          coa_updated_date_utc?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          platform_name?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_integration_chart_of_acco_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_chart_of_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_chart_of_platform_integration_organiz_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_integration_google_ads_data: {
        Row: {
          account_name: string | null
          average_cpc: number | null
          cost_per_conversion: number | null
          created_at: string | null
          currency: string | null
          customer_id: string | null
          developer_token: string | null
          id: string
          is_selected: boolean | null
          last_sync_at: string | null
          login_customer_id: string | null
          organization_id: string
          platform_integration_id: string
          raw_account_info: Json | null
          raw_campaigns: Json | null
          raw_metrics: Json | null
          status: string | null
          timezone: string | null
          total_clicks: number | null
          total_conversions: number | null
          total_impressions: number | null
          total_spend: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_name?: string | null
          average_cpc?: number | null
          cost_per_conversion?: number | null
          created_at?: string | null
          currency?: string | null
          customer_id?: string | null
          developer_token?: string | null
          id?: string
          is_selected?: boolean | null
          last_sync_at?: string | null
          login_customer_id?: string | null
          organization_id: string
          platform_integration_id: string
          raw_account_info?: Json | null
          raw_campaigns?: Json | null
          raw_metrics?: Json | null
          status?: string | null
          timezone?: string | null
          total_clicks?: number | null
          total_conversions?: number | null
          total_impressions?: number | null
          total_spend?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_name?: string | null
          average_cpc?: number | null
          cost_per_conversion?: number | null
          created_at?: string | null
          currency?: string | null
          customer_id?: string | null
          developer_token?: string | null
          id?: string
          is_selected?: boolean | null
          last_sync_at?: string | null
          login_customer_id?: string | null
          organization_id?: string
          platform_integration_id?: string
          raw_account_info?: Json | null
          raw_campaigns?: Json | null
          raw_metrics?: Json | null
          status?: string | null
          timezone?: string | null
          total_clicks?: number | null
          total_conversions?: number | null
          total_impressions?: number | null
          total_spend?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_integration_google_ads_da_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_google_ads_data_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_integration_google_analytics_data: {
        Row: {
          account_id: string | null
          account_name: string | null
          created_at: string | null
          currency: string | null
          domain: string
          id: string
          industry_category: string | null
          is_selected: boolean | null
          measurement_id: string | null
          organization_id: string
          platform_integration_id: string
          property_code: string | null
          property_id: string | null
          property_name: string | null
          property_type: string | null
          raw_account_summaries: Json | null
          raw_data_streams: Json | null
          raw_property_details: Json | null
          status: string | null
          timezone: string | null
          updated_at: string | null
          user_id: string
          website_url: string | null
        }
        Insert: {
          account_id?: string | null
          account_name?: string | null
          created_at?: string | null
          currency?: string | null
          domain: string
          id?: string
          industry_category?: string | null
          is_selected?: boolean | null
          measurement_id?: string | null
          organization_id: string
          platform_integration_id: string
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          property_type?: string | null
          raw_account_summaries?: Json | null
          raw_data_streams?: Json | null
          raw_property_details?: Json | null
          status?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id: string
          website_url?: string | null
        }
        Update: {
          account_id?: string | null
          account_name?: string | null
          created_at?: string | null
          currency?: string | null
          domain?: string
          id?: string
          industry_category?: string | null
          is_selected?: boolean | null
          measurement_id?: string | null
          organization_id?: string
          platform_integration_id?: string
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          property_type?: string | null
          raw_account_summaries?: Json | null
          raw_data_streams?: Json | null
          raw_property_details?: Json | null
          status?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_integration_google_analyt_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_google_analytics_data_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_integration_invoice_line_items: {
        Row: {
          account_code: string | null
          account_id: string | null
          account_name: string | null
          api_record_created_at: string | null
          api_record_updated_at: string | null
          class_ref_id: string | null
          class_ref_name: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          detail_type: string | null
          discount: number | null
          discount_amount: number | null
          discount_rate: number | null
          gross: number | null
          id: string
          invoice_id: string | null
          is_nhs: boolean | null
          item_code: string | null
          item_name: string | null
          item_ref_id: string | null
          item_ref_name: string | null
          line_amount: number | null
          line_number: number | null
          net: number | null
          nhs_band: string | null
          organization_id: string
          platform_line_id: string | null
          practitioner_id: string | null
          quantity: number | null
          quickbooks_line_id: string | null
          service_date: string | null
          sundry_id: string | null
          tax: number | null
          tax_amount: number | null
          tax_code_ref: string | null
          tax_rate: number | null
          tax_type: string | null
          tooth_ref: string | null
          treatment_category: string | null
          treatment_code: string | null
          treatment_id: string | null
          treatment_plan_id: string | null
          treatment_plan_item_id: string | null
          unit_amount: number | null
          unit_of_measure: string | null
          updated_at: string | null
          xero_line_item_id: string | null
        }
        Insert: {
          account_code?: string | null
          account_id?: string | null
          account_name?: string | null
          api_record_created_at?: string | null
          api_record_updated_at?: string | null
          class_ref_id?: string | null
          class_ref_name?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          detail_type?: string | null
          discount?: number | null
          discount_amount?: number | null
          discount_rate?: number | null
          gross?: number | null
          id?: string
          invoice_id?: string | null
          is_nhs?: boolean | null
          item_code?: string | null
          item_name?: string | null
          item_ref_id?: string | null
          item_ref_name?: string | null
          line_amount?: number | null
          line_number?: number | null
          net?: number | null
          nhs_band?: string | null
          organization_id: string
          platform_line_id?: string | null
          practitioner_id?: string | null
          quantity?: number | null
          quickbooks_line_id?: string | null
          service_date?: string | null
          sundry_id?: string | null
          tax?: number | null
          tax_amount?: number | null
          tax_code_ref?: string | null
          tax_rate?: number | null
          tax_type?: string | null
          tooth_ref?: string | null
          treatment_category?: string | null
          treatment_code?: string | null
          treatment_id?: string | null
          treatment_plan_id?: string | null
          treatment_plan_item_id?: string | null
          unit_amount?: number | null
          unit_of_measure?: string | null
          updated_at?: string | null
          xero_line_item_id?: string | null
        }
        Update: {
          account_code?: string | null
          account_id?: string | null
          account_name?: string | null
          api_record_created_at?: string | null
          api_record_updated_at?: string | null
          class_ref_id?: string | null
          class_ref_name?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          detail_type?: string | null
          discount?: number | null
          discount_amount?: number | null
          discount_rate?: number | null
          gross?: number | null
          id?: string
          invoice_id?: string | null
          is_nhs?: boolean | null
          item_code?: string | null
          item_name?: string | null
          item_ref_id?: string | null
          item_ref_name?: string | null
          line_amount?: number | null
          line_number?: number | null
          net?: number | null
          nhs_band?: string | null
          organization_id?: string
          platform_line_id?: string | null
          practitioner_id?: string | null
          quantity?: number | null
          quickbooks_line_id?: string | null
          service_date?: string | null
          sundry_id?: string | null
          tax?: number | null
          tax_amount?: number | null
          tax_code_ref?: string | null
          tax_rate?: number | null
          tax_type?: string | null
          tooth_ref?: string | null
          treatment_category?: string | null
          treatment_code?: string | null
          treatment_id?: string | null
          treatment_plan_id?: string | null
          treatment_plan_item_id?: string | null
          unit_amount?: number | null
          unit_of_measure?: string | null
          updated_at?: string | null
          xero_line_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_integration_invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_invoice_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_integration_invoices: {
        Row: {
          account_id: number | null
          allow_online_ach: boolean | null
          allow_online_credit_card: boolean | null
          allow_online_payment: boolean | null
          amount_due: number | null
          amount_outstanding: number | null
          amount_paid: number | null
          api_record_created_at: string | null
          api_record_updated_at: string | null
          branding_theme_id: string | null
          contact_email: string | null
          contact_id: string | null
          contact_name: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          currency_rate: number | null
          customer_ref_id: string | null
          customer_ref_name: string | null
          deleted_at: string | null
          due_date: string | null
          footnote: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          invoice_type: string | null
          invoice_url: string | null
          invoice_user_id: string | null
          is_paid: boolean | null
          last_synced_at: string | null
          line_amount_types: string | null
          location_id: string | null
          nhs_amount: number | null
          organization_id: string
          paid_date: string | null
          patient_id: string | null
          payment_terms: string | null
          platform_invoice_id: string
          platform_type: string
          private_note: string | null
          quickbooks_id: string | null
          reference: string | null
          sent_at: string | null
          site_id: string | null
          status: string | null
          subtotal: number | null
          sync_error: string | null
          sync_status: string | null
          tax_amount: number | null
          tax_type: string | null
          total_amount: number | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
          xero_invoice_id: string | null
        }
        Insert: {
          account_id?: number | null
          allow_online_ach?: boolean | null
          allow_online_credit_card?: boolean | null
          allow_online_payment?: boolean | null
          amount_due?: number | null
          amount_outstanding?: number | null
          amount_paid?: number | null
          api_record_created_at?: string | null
          api_record_updated_at?: string | null
          branding_theme_id?: string | null
          contact_email?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          currency_rate?: number | null
          customer_ref_id?: string | null
          customer_ref_name?: string | null
          deleted_at?: string | null
          due_date?: string | null
          footnote?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string | null
          invoice_url?: string | null
          invoice_user_id?: string | null
          is_paid?: boolean | null
          last_synced_at?: string | null
          line_amount_types?: string | null
          location_id?: string | null
          nhs_amount?: number | null
          organization_id: string
          paid_date?: string | null
          patient_id?: string | null
          payment_terms?: string | null
          platform_invoice_id: string
          platform_type: string
          private_note?: string | null
          quickbooks_id?: string | null
          reference?: string | null
          sent_at?: string | null
          site_id?: string | null
          status?: string | null
          subtotal?: number | null
          sync_error?: string | null
          sync_status?: string | null
          tax_amount?: number | null
          tax_type?: string | null
          total_amount?: number | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          xero_invoice_id?: string | null
        }
        Update: {
          account_id?: number | null
          allow_online_ach?: boolean | null
          allow_online_credit_card?: boolean | null
          allow_online_payment?: boolean | null
          amount_due?: number | null
          amount_outstanding?: number | null
          amount_paid?: number | null
          api_record_created_at?: string | null
          api_record_updated_at?: string | null
          branding_theme_id?: string | null
          contact_email?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          currency_rate?: number | null
          customer_ref_id?: string | null
          customer_ref_name?: string | null
          deleted_at?: string | null
          due_date?: string | null
          footnote?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string | null
          invoice_url?: string | null
          invoice_user_id?: string | null
          is_paid?: boolean | null
          last_synced_at?: string | null
          line_amount_types?: string | null
          location_id?: string | null
          nhs_amount?: number | null
          organization_id?: string
          paid_date?: string | null
          patient_id?: string | null
          payment_terms?: string | null
          platform_invoice_id?: string
          platform_type?: string
          private_note?: string | null
          quickbooks_id?: string | null
          reference?: string | null
          sent_at?: string | null
          site_id?: string | null
          status?: string | null
          subtotal?: number | null
          sync_error?: string | null
          sync_status?: string | null
          tax_amount?: number | null
          tax_type?: string | null
          total_amount?: number | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          xero_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_integration_invoices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_integration_organization_mapping: {
        Row: {
          created_at: string | null
          id: string
          location_id: string
          organization_id: string
          platform_integration_id: string
          platform_integration_organizations_id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          location_id: string
          organization_id: string
          platform_integration_id: string
          platform_integration_organizations_id: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          location_id?: string
          organization_id?: string
          platform_integration_id?: string
          platform_integration_organizations_id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_integration_organiza_platform_integration_organiz_fkey"
            columns: ["platform_integration_organizations_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_organization__platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_organization_mapping_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_organization_mapping_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_integration_organizations: {
        Row: {
          country: string | null
          created_at: string | null
          currency: string | null
          email: string | null
          id: string
          is_selected: boolean | null
          meta_data: Json | null
          organization_id: string
          platform_integration_id: string
          platform_name: string
          platform_org_code: string | null
          platform_org_id: string
          platform_org_name: string | null
          raw_data: Json | null
          status: string | null
          timezone: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          id?: string
          is_selected?: boolean | null
          meta_data?: Json | null
          organization_id: string
          platform_integration_id: string
          platform_name: string
          platform_org_code?: string | null
          platform_org_id: string
          platform_org_name?: string | null
          raw_data?: Json | null
          status?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          country?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          id?: string
          is_selected?: boolean | null
          meta_data?: Json | null
          organization_id?: string
          platform_integration_id?: string
          platform_name?: string
          platform_org_code?: string | null
          platform_org_id?: string
          platform_org_name?: string | null
          raw_data?: Json | null
          status?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_integration_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_integration_organizations_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_integrations: {
        Row: {
          access_token: string | null
          client_id: string | null
          client_secret: string | null
          created_at: string | null
          id: string
          is_connected: boolean | null
          last_synced_at: string | null
          organization_id: string
          platform_name: string
          refresh_token: string | null
          token_expires_at: string | null
          updated_at: string | null
          user_id: string | null
          username: string | null
        }
        Insert: {
          access_token?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          id?: string
          is_connected?: boolean | null
          last_synced_at?: string | null
          organization_id: string
          platform_name: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
        }
        Update: {
          access_token?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          id?: string
          is_connected?: boolean | null
          last_synced_at?: string | null
          organization_id?: string
          platform_name?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_journal_details: {
        Row: {
          account_code: string | null
          account_id: string | null
          account_name: string | null
          account_type: string | null
          created_at: string | null
          description: string | null
          gross_amount: number | null
          id: string
          journal_date: string
          journal_id: string | null
          journal_line_id: string | null
          net_amount: number | null
          organization_id: string
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
          platform_journal_id: string | null
          source_id: string | null
          tax_amount: number | null
          tax_name: string | null
          tax_type: string | null
          updated_at: string | null
        }
        Insert: {
          account_code?: string | null
          account_id?: string | null
          account_name?: string | null
          account_type?: string | null
          created_at?: string | null
          description?: string | null
          gross_amount?: number | null
          id?: string
          journal_date: string
          journal_id?: string | null
          journal_line_id?: string | null
          net_amount?: number | null
          organization_id: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          platform_journal_id?: string | null
          source_id?: string | null
          tax_amount?: number | null
          tax_name?: string | null
          tax_type?: string | null
          updated_at?: string | null
        }
        Update: {
          account_code?: string | null
          account_id?: string | null
          account_name?: string | null
          account_type?: string | null
          created_at?: string | null
          description?: string | null
          gross_amount?: number | null
          id?: string
          journal_date?: string
          journal_id?: string | null
          journal_line_id?: string | null
          net_amount?: number | null
          organization_id?: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          platform_journal_id?: string | null
          source_id?: string | null
          tax_amount?: number | null
          tax_name?: string | null
          tax_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_journal_details_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "platform_journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_journal_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_journal_details_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_journal_details_platform_integration_organization_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_journals: {
        Row: {
          contact_id: string | null
          contact_name: string | null
          created_at: string | null
          due_amount: number | null
          id: string
          is_deleted_from_platform: boolean | null
          is_ignore_transactions: boolean | null
          journal_date: string
          journal_id: string | null
          journal_number: number
          organization_id: string
          platform_created_date_utc: string
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
          reference: string | null
          source_id: string | null
          source_type: string
          source_type_desc: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          due_amount?: number | null
          id?: string
          is_deleted_from_platform?: boolean | null
          is_ignore_transactions?: boolean | null
          journal_date: string
          journal_id?: string | null
          journal_number: number
          organization_id: string
          platform_created_date_utc: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          reference?: string | null
          source_id?: string | null
          source_type: string
          source_type_desc?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          due_amount?: number | null
          id?: string
          is_deleted_from_platform?: boolean | null
          is_ignore_transactions?: boolean | null
          journal_date?: string
          journal_id?: string | null
          journal_number?: number
          organization_id?: string
          platform_created_date_utc?: string
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          reference?: string | null
          source_id?: string | null
          source_type?: string
          source_type_desc?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_journals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_journals_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_journals_platform_integration_organization_id_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_overpayments: {
        Row: {
          account_type: string | null
          contact_id: string | null
          contact_name: string | null
          created_at: string | null
          currency_code: string | null
          id: string
          line_amount_types: string | null
          organization_id: string
          overpayment_date: string
          overpayment_id: string | null
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
          remaining_credit: number | null
          status: string | null
          sub_total: number | null
          total: number | null
          total_tax: number | null
          updated_at: string | null
          updated_date_utc: string
        }
        Insert: {
          account_type?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          currency_code?: string | null
          id?: string
          line_amount_types?: string | null
          organization_id: string
          overpayment_date: string
          overpayment_id?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          remaining_credit?: number | null
          status?: string | null
          sub_total?: number | null
          total?: number | null
          total_tax?: number | null
          updated_at?: string | null
          updated_date_utc: string
        }
        Update: {
          account_type?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          currency_code?: string | null
          id?: string
          line_amount_types?: string | null
          organization_id?: string
          overpayment_date?: string
          overpayment_id?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          remaining_credit?: number | null
          status?: string | null
          sub_total?: number | null
          total?: number | null
          total_tax?: number | null
          updated_at?: string | null
          updated_date_utc?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_overpayments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_overpayments_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_overpayments_platform_integration_organization_id_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_payments: {
        Row: {
          accounts_payable_invoice_id: string | null
          amount: number | null
          created_at: string | null
          currency_rate: number | null
          id: string
          invoice_id: string | null
          organization_id: string
          payment_date: string | null
          payment_id: string | null
          platform_integration_id: string | null
          platform_integration_organization_id: string | null
          reference: string | null
          transaction_type: string
          updated_at: string | null
        }
        Insert: {
          accounts_payable_invoice_id?: string | null
          amount?: number | null
          created_at?: string | null
          currency_rate?: number | null
          id?: string
          invoice_id?: string | null
          organization_id: string
          payment_date?: string | null
          payment_id?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          reference?: string | null
          transaction_type: string
          updated_at?: string | null
        }
        Update: {
          accounts_payable_invoice_id?: string | null
          amount?: number | null
          created_at?: string | null
          currency_rate?: number | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          payment_date?: string | null
          payment_id?: string | null
          platform_integration_id?: string | null
          platform_integration_organization_id?: string | null
          reference?: string | null
          transaction_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_payments_accounts_payable_invoice_id_fkey"
            columns: ["accounts_payable_invoice_id"]
            isOneToOne: false
            referencedRelation: "accounts_payable_invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_payments_platform_integration_id_fkey"
            columns: ["platform_integration_id"]
            isOneToOne: false
            referencedRelation: "platform_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_payments_platform_integration_organization_id_fkey"
            columns: ["platform_integration_organization_id"]
            isOneToOne: false
            referencedRelation: "platform_integration_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_locations: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          api_record_unique_id: string | null
          city: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          email: string | null
          fax: string | null
          id: string
          is_active: boolean | null
          is_primary: boolean | null
          location_code: string | null
          location_name: string
          notes: string | null
          operating_hours: Json | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          region_id: string | null
          state: string | null
          timezone: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
          logo_url: string | null
          private_income_source: string | null
          membership_income_source: string | null
          nhs_income_source: string | null
          private_income_accounts: Json | null
          membership_income_accounts: Json | null
          nhs_income_accounts: Json | null
          lab_fees_accounts: Json | null
          staff_costs_accounts: Json | null
          operating_lease_accounts: Json | null
          chairs_count: number | null
          week_open_per_year: number | null
          days_open_per_week: number | null
          open_hours_per_day: number | null
          number_of_surgeries: number | null
          associate_weeks_per_year: number | null
          associate_days_per_week: number | null
          associate_cost_lab_source: string | null
          associate_cost_labs_percent: number | null
          material_cost_source: string | null
          practice_cost_materials_percent: number | null
          target_profit_percent: number | null
          target_chair_revenue_per_hour: number | null
          employee_working_duration_type: string | null
          is_associate_pay_including_lab_cost: boolean | null
          is_associate_pay_including_material_cost: boolean | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          api_record_unique_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          location_code?: string | null
          location_name: string
          notes?: string | null
          operating_hours?: Json | null
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          region_id?: string | null
          state?: string | null
          timezone?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          logo_url?: string | null
          private_income_source?: string | null
          membership_income_source?: string | null
          nhs_income_source?: string | null
          private_income_accounts?: Json | null
          membership_income_accounts?: Json | null
          nhs_income_accounts?: Json | null
          lab_fees_accounts?: Json | null
          staff_costs_accounts?: Json | null
          operating_lease_accounts?: Json | null
          chairs_count?: number | null
          week_open_per_year?: number | null
          days_open_per_week?: number | null
          open_hours_per_day?: number | null
          number_of_surgeries?: number | null
          associate_weeks_per_year?: number | null
          associate_days_per_week?: number | null
          associate_cost_lab_source?: string | null
          associate_cost_labs_percent?: number | null
          material_cost_source?: string | null
          practice_cost_materials_percent?: number | null
          target_profit_percent?: number | null
          target_chair_revenue_per_hour?: number | null
          employee_working_duration_type?: string | null
          is_associate_pay_including_lab_cost?: boolean | null
          is_associate_pay_including_material_cost?: boolean | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          api_record_unique_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          location_code?: string | null
          location_name?: string
          notes?: string | null
          operating_hours?: Json | null
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          region_id?: string | null
          state?: string | null
          timezone?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
          logo_url?: string | null
          private_income_source?: string | null
          membership_income_source?: string | null
          nhs_income_source?: string | null
          private_income_accounts?: Json | null
          membership_income_accounts?: Json | null
          nhs_income_accounts?: Json | null
          lab_fees_accounts?: Json | null
          staff_costs_accounts?: Json | null
          operating_lease_accounts?: Json | null
          chairs_count?: number | null
          week_open_per_year?: number | null
          days_open_per_week?: number | null
          open_hours_per_day?: number | null
          number_of_surgeries?: number | null
          associate_weeks_per_year?: number | null
          associate_days_per_week?: number | null
          associate_cost_lab_source?: string | null
          associate_cost_labs_percent?: number | null
          material_cost_source?: string | null
          practice_cost_materials_percent?: number | null
          target_profit_percent?: number | null
          target_chair_revenue_per_hour?: number | null
          employee_working_duration_type?: string | null
          is_associate_pay_including_lab_cost?: boolean | null
          is_associate_pay_including_material_cost?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "practice_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_locations_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      practices: {
        Row: {
          address: string | null
          chairs: number | null
          created_at: string
          email: string | null
          id: string
          name: string
          organization_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          chairs?: number | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          organization_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          chairs?: number | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          central_auth_id: string | null
          created_at: string
          current_organization_id: string | null
          email: string | null
          full_name: string | null
          id: string
          onboarding_skipped: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          central_auth_id?: string | null
          created_at?: string
          current_organization_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_skipped?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          central_auth_id?: string | null
          created_at?: string
          current_organization_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_skipped?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_current_organization_id_fkey"
            columns: ["current_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_sliding_scales: {
        Row: {
          band_name: string
          created_at: string
          end_amount: number
          id: string
          organization_id: string
          percentage_value: number
          provider_id: string
          scale_type: string
          start_amount: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          band_name: string
          created_at?: string
          end_amount: number
          id?: string
          organization_id: string
          percentage_value: number
          provider_id: string
          scale_type: string
          start_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          band_name?: string
          created_at?: string
          end_amount?: number
          id?: string
          organization_id?: string
          percentage_value?: number
          provider_id?: string
          scale_type?: string
          start_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_sliding_scales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_sliding_scales_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_types: {
        Row: {
          code: string
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_monthly_costs: {
        Row: {
          id: string
          organization_id: string
          provider_id: string
          month: string
          lab_cost_value: number | null
          material_cost_value: number | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          provider_id: string
          month: string
          lab_cost_value?: number | null
          material_cost_value?: number | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          provider_id?: string
          month?: string
          lab_cost_value?: number | null
          material_cost_value?: number | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_monthly_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_monthly_costs_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          additional_options: number | null
          associate_split_percentage: number | null
          avg_rev_per_patient: number
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          external_id: number | null
          gdc_number: string | null
          id: string
          is_active: boolean
          is_principal_associate: boolean
          joining_date: string | null
          lab_cost_account_id: string | null
          lab_cost_account_platform: string | null
          lab_cost_percentage: number | null
          lab_cost_source_method: string | null
          lab_split_percentage: number | null
          lab_split_percentage_sliding: number | null
          leaving_date: string | null
          location_id: string | null
          material_cost_account_id: string | null
          material_cost_account_platform: string | null
          material_cost_percentage: number | null
          material_cost_source_method: string | null
          material_split_percentage: number | null
          membership_income: string | null
          name: string
          nhs_income: string | null
          nhs_number: string | null
          organization_id: string
          patients: number
          phone: string | null
          photo_url: string | null
          practice_id: string | null
          primary_chair: string | null
          provider_code: string | null
          provider_role: string | null
          provider_type_id: string | null
          region_id: string | null
          revenue: number
          specialty_id: string | null
          split_source_method: string | null
          trend: number
          uda_target: number | null
          uoa_target: number | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
          utilisation: number
        }
        Insert: {
          additional_options?: number | null
          associate_split_percentage?: number | null
          avg_rev_per_patient?: number
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          external_id?: number | null
          gdc_number?: string | null
          id?: string
          is_active?: boolean
          is_principal_associate?: boolean
          joining_date?: string | null
          lab_cost_account_id?: string | null
          lab_cost_account_platform?: string | null
          lab_cost_percentage?: number | null
          lab_cost_source_method?: string | null
          lab_split_percentage?: number | null
          lab_split_percentage_sliding?: number | null
          leaving_date?: string | null
          location_id?: string | null
          material_cost_account_id?: string | null
          material_cost_account_platform?: string | null
          material_cost_percentage?: number | null
          material_cost_source_method?: string | null
          material_split_percentage?: number | null
          membership_income?: string | null
          name: string
          nhs_income?: string | null
          nhs_number?: string | null
          organization_id: string
          patients?: number
          phone?: string | null
          photo_url?: string | null
          practice_id?: string | null
          primary_chair?: string | null
          provider_code?: string | null
          provider_role?: string | null
          provider_type_id?: string | null
          region_id?: string | null
          revenue?: number
          specialty_id?: string | null
          split_source_method?: string | null
          trend?: number
          uda_target?: number | null
          uoa_target?: number | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          utilisation?: number
        }
        Update: {
          additional_options?: number | null
          associate_split_percentage?: number | null
          avg_rev_per_patient?: number
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          external_id?: number | null
          gdc_number?: string | null
          id?: string
          is_active?: boolean
          is_principal_associate?: boolean
          joining_date?: string | null
          lab_cost_account_id?: string | null
          lab_cost_account_platform?: string | null
          lab_cost_percentage?: number | null
          lab_cost_source_method?: string | null
          lab_split_percentage?: number | null
          lab_split_percentage_sliding?: number | null
          leaving_date?: string | null
          location_id?: string | null
          material_cost_account_id?: string | null
          material_cost_account_platform?: string | null
          material_cost_percentage?: number | null
          material_cost_source_method?: string | null
          material_split_percentage?: number | null
          membership_income?: string | null
          name?: string
          nhs_income?: string | null
          nhs_number?: string | null
          organization_id?: string
          patients?: number
          phone?: string | null
          photo_url?: string | null
          practice_id?: string | null
          primary_chair?: string | null
          provider_code?: string | null
          provider_role?: string | null
          provider_type_id?: string | null
          region_id?: string | null
          revenue?: number
          specialty_id?: string | null
          split_source_method?: string | null
          trend?: number
          uda_target?: number | null
          uoa_target?: number | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          utilisation?: number
        }
        Relationships: [
          {
            foreignKeyName: "providers_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_practice_id_fkey"
            columns: ["practice_id"]
            isOneToOne: false
            referencedRelation: "practices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_provider_type_id_fkey"
            columns: ["provider_type_id"]
            isOneToOne: false
            referencedRelation: "provider_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_specialty_id_fkey"
            columns: ["specialty_id"]
            isOneToOne: false
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          code: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "regions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_scenarios: {
        Row: {
          created_at: string
          current_ebitda: number
          description: string | null
          id: string
          lab_fees_percent: number
          name: string
          operating_leases_percent: number
          organization_id: string
          staff_costs_percent: number
          total_revenue: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_ebitda: number
          description?: string | null
          id?: string
          lab_fees_percent?: number
          name: string
          operating_leases_percent?: number
          organization_id: string
          staff_costs_percent?: number
          total_revenue: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_ebitda?: number
          description?: string | null
          id?: string
          lab_fees_percent?: number
          name?: string
          operating_leases_percent?: number
          organization_id?: string
          staff_costs_percent?: number
          total_revenue?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_scenarios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      specialties: {
        Row: {
          code: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          provider_type_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          provider_type_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          provider_type_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "specialties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specialties_provider_type_id_fkey"
            columns: ["provider_type_id"]
            isOneToOne: false
            referencedRelation: "provider_types"
            referencedColumns: ["id"]
          },
        ]
      }
      superadmins: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          role: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          full_name?: string | null
          id: string
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          role?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_page: number | null
          end_date: string | null
          entity_alias: string | null
          error_message: string | null
          id: string
          integration_id: string
          job_type: string
          max_retries: number | null
          organization_id: string
          progress_percentage: number | null
          records_failed: number | null
          records_processed: number | null
          retry_count: number | null
          start_date: string | null
          started_at: string | null
          status: string
          total_pages: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_page?: number | null
          end_date?: string | null
          entity_alias?: string | null
          error_message?: string | null
          id?: string
          integration_id: string
          job_type: string
          max_retries?: number | null
          organization_id: string
          progress_percentage?: number | null
          records_failed?: number | null
          records_processed?: number | null
          retry_count?: number | null
          start_date?: string | null
          started_at?: string | null
          status?: string
          total_pages?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_page?: number | null
          end_date?: string | null
          entity_alias?: string | null
          error_message?: string | null
          id?: string
          integration_id?: string
          job_type?: string
          max_retries?: number | null
          organization_id?: string
          progress_percentage?: number | null
          records_failed?: number | null
          records_processed?: number | null
          retry_count?: number | null
          start_date?: string | null
          started_at?: string | null
          status?: string
          total_pages?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
          organization_id: string
          photo_url: string | null
          practice_id: string | null
          role_type: string
          specialization: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          name: string
          organization_id: string
          photo_url?: string | null
          practice_id?: string | null
          role_type: string
          specialization?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          photo_url?: string | null
          practice_id?: string | null
          role_type?: string
          specialization?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_practice_id_fkey"
            columns: ["practice_id"]
            isOneToOne: false
            referencedRelation: "practices"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_appointments: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          location_id: string | null
          organization_id: string
          region_id: string | null
          ta_appointment_id: number | null
          ta_bookable: boolean | null
          ta_created_at: string | null
          ta_id: number | null
          ta_patient_id: number | null
          ta_treatment_plan_id: number | null
          ta_updated_at: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          location_id?: string | null
          organization_id: string
          region_id?: string | null
          ta_appointment_id?: number | null
          ta_bookable?: boolean | null
          ta_created_at?: string | null
          ta_id?: number | null
          ta_patient_id?: number | null
          ta_treatment_plan_id?: number | null
          ta_updated_at?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          location_id?: string | null
          organization_id?: string
          region_id?: string | null
          ta_appointment_id?: number | null
          ta_bookable?: boolean | null
          ta_created_at?: string | null
          ta_id?: number | null
          ta_patient_id?: number | null
          ta_treatment_plan_id?: number | null
          ta_updated_at?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_appointments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_appointments_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_budget_planning: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          location_id: string
          organization_id: string
          period: string
          planned_revenue: number | null
          planned_volume: number | null
          target_margin: number | null
          treatment_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          location_id: string
          organization_id: string
          period: string
          planned_revenue?: number | null
          planned_volume?: number | null
          target_margin?: number | null
          treatment_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          location_id?: string
          organization_id?: string
          period?: string
          planned_revenue?: number | null
          planned_volume?: number | null
          target_margin?: number | null
          treatment_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_budget_planning_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_budget_planning_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_budget_planning_treatment_id_fkey"
            columns: ["treatment_id"]
            isOneToOne: false
            referencedRelation: "treatments"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_categories: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          display_order: number | null
          external_id: number | null
          id: string
          location_id: string | null
          name: string
          organization_id: string
          region_id: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number | null
          external_id?: number | null
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number | null
          external_id?: number | null
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
          region_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_categories_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_categories_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_goal_targets: {
        Row: {
          avg_amount_target: number
          category_name: string
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          organization_id: string
          period_date: string
          period_type: string
          region_id: string | null
          unit_target: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          avg_amount_target?: number
          category_name: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          organization_id: string
          period_date: string
          period_type: string
          region_id?: string | null
          unit_target?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          avg_amount_target?: number
          category_name?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          organization_id?: string
          period_date?: string
          period_type?: string
          region_id?: string | null
          unit_target?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_goal_targets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_goal_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_goal_targets_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_plan_items: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          duration: number | null
          id: string
          location_id: string | null
          organization_id: string
          region_id: string | null
          tpi_charged: boolean | null
          tpi_completed: boolean | null
          tpi_completed_at: string | null
          tpi_created_at: string | null
          tpi_id: number | null
          tpi_invoice_id: number | null
          tpi_patient_id: number | null
          tpi_patient_nomenclature: string | null
          tpi_payment_plan_id: number | null
          tpi_practitioner_id: number | null
          tpi_price: number | null
          tpi_treatment_appointment_id: number | null
          tpi_treatment_id: number | null
          tpi_treatment_plan_id: number | null
          tpi_updated_at: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration?: number | null
          id?: string
          location_id?: string | null
          organization_id: string
          region_id?: string | null
          tpi_charged?: boolean | null
          tpi_completed?: boolean | null
          tpi_completed_at?: string | null
          tpi_created_at?: string | null
          tpi_id?: number | null
          tpi_invoice_id?: number | null
          tpi_patient_id?: number | null
          tpi_patient_nomenclature?: string | null
          tpi_payment_plan_id?: number | null
          tpi_practitioner_id?: number | null
          tpi_price?: number | null
          tpi_treatment_appointment_id?: number | null
          tpi_treatment_id?: number | null
          tpi_treatment_plan_id?: number | null
          tpi_updated_at?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          duration?: number | null
          id?: string
          location_id?: string | null
          organization_id?: string
          region_id?: string | null
          tpi_charged?: boolean | null
          tpi_completed?: boolean | null
          tpi_completed_at?: string | null
          tpi_created_at?: string | null
          tpi_id?: number | null
          tpi_invoice_id?: number | null
          tpi_patient_id?: number | null
          tpi_patient_nomenclature?: string | null
          tpi_payment_plan_id?: number | null
          tpi_practitioner_id?: number | null
          tpi_price?: number | null
          tpi_treatment_appointment_id?: number | null
          tpi_treatment_id?: number | null
          tpi_treatment_plan_id?: number | null
          tpi_updated_at?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plan_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_items_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_plans: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          location_id: string | null
          organization_id: string
          region_id: string | null
          tp_completed_at: string | null
          tp_created_at: string | null
          tp_end_date: string | null
          tp_id: number | null
          tp_is_completed: boolean | null
          tp_last_completed_at: string | null
          tp_nickname: string | null
          tp_patient_id: number | null
          tp_practitioner_id: number | null
          tp_private_treatment_value: number | null
          tp_start_date: string | null
          tp_updated_at: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          organization_id: string
          region_id?: string | null
          tp_completed_at?: string | null
          tp_created_at?: string | null
          tp_end_date?: string | null
          tp_id?: number | null
          tp_is_completed?: boolean | null
          tp_last_completed_at?: string | null
          tp_nickname?: string | null
          tp_patient_id?: number | null
          tp_practitioner_id?: number | null
          tp_private_treatment_value?: number | null
          tp_start_date?: string | null
          tp_updated_at?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          organization_id?: string
          region_id?: string | null
          tp_completed_at?: string | null
          tp_created_at?: string | null
          tp_end_date?: string | null
          tp_id?: number | null
          tp_is_completed?: boolean | null
          tp_last_completed_at?: string | null
          tp_nickname?: string | null
          tp_patient_id?: number | null
          tp_practitioner_id?: number | null
          tp_private_treatment_value?: number | null
          tp_start_date?: string | null
          tp_updated_at?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      treatments: {
        Row: {
          average: number | null
          average_time_minutes: number | null
          category_id: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          duration_minutes: number | null
          external_id: number | null
          finance_fee: number | null
          hourly_rate: number | null
          id: string
          insurance_classification: string | null
          is_active: boolean | null
          lab_bill: number | null
          lab_bill_discount: number | null
          location_id: string | null
          material_cost: number | null
          nhs_band: string | null
          nhs_price: number | null
          nhs_treatment_cat: string | null
          no_items: number | null
          nomenclature: string | null
          notes: string | null
          organization_id: string
          owner: string | null
          patient_description: string | null
          patient_nomenclature: string | null
          percent_fees: number | null
          price: number
          private_price: number | null
          region: string | null
          region_id: string | null
          requires_followup: boolean | null
          therapist_pay_rate: number | null
          therapist_time_mins: number | null
          treatment_code: string | null
          treatment_name: string
          treatment_type: string
          type_of_treatment: string | null
          uda_band: string | null
          updated_at: string | null
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          average?: number | null
          average_time_minutes?: number | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          external_id?: number | null
          finance_fee?: number | null
          hourly_rate?: number | null
          id?: string
          insurance_classification?: string | null
          is_active?: boolean | null
          lab_bill?: number | null
          lab_bill_discount?: number | null
          location_id?: string | null
          material_cost?: number | null
          nhs_band?: string | null
          nhs_price?: number | null
          nhs_treatment_cat?: string | null
          no_items?: number | null
          nomenclature?: string | null
          notes?: string | null
          organization_id: string
          owner?: string | null
          patient_description?: string | null
          patient_nomenclature?: string | null
          percent_fees?: number | null
          price: number
          private_price?: number | null
          region?: string | null
          region_id?: string | null
          requires_followup?: boolean | null
          therapist_pay_rate?: number | null
          therapist_time_mins?: number | null
          treatment_code?: string | null
          treatment_name: string
          treatment_type: string
          type_of_treatment?: string | null
          uda_band?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          average?: number | null
          average_time_minutes?: number | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          external_id?: number | null
          finance_fee?: number | null
          hourly_rate?: number | null
          id?: string
          insurance_classification?: string | null
          is_active?: boolean | null
          lab_bill?: number | null
          lab_bill_discount?: number | null
          location_id?: string | null
          material_cost?: number | null
          nhs_band?: string | null
          nhs_price?: number | null
          nhs_treatment_cat?: string | null
          no_items?: number | null
          nomenclature?: string | null
          notes?: string | null
          organization_id?: string
          owner?: string | null
          patient_description?: string | null
          patient_nomenclature?: string | null
          percent_fees?: number | null
          price?: number
          private_price?: number | null
          region?: string | null
          region_id?: string | null
          requires_followup?: boolean | null
          therapist_pay_rate?: number | null
          therapist_time_mins?: number | null
          treatment_code?: string | null
          treatment_name?: string
          treatment_type?: string
          type_of_treatment?: string | null
          uda_band?: string | null
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "treatment_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "practice_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatments_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_roles: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          color: string | null
          is_system: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          color?: string | null
          is_system?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          color?: string | null
          is_system?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          id: string
          custom_role_id: string
          module: string
          card: string | null
          action_type: string
          granted: boolean
          created_at: string
        }
        Insert: {
          id?: string
          custom_role_id: string
          module: string
          card?: string | null
          action_type: string
          granted?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          custom_role_id?: string
          module?: string
          card?: string | null
          action_type?: string
          granted?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          custom_role_id: string | null
          id: string
          is_active: boolean
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_role_id?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          custom_role_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      chart_account_payable_analytics: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          invoice_count: number
          month_name: string
          month_year: string
          total_amount: number
        }[]
      }
      chart_account_payable_automation: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          email_count: number
          manual_count: number
          month_name: string
          month_year: string
          total_count: number
        }[]
      }
      chart_account_payable_supplier: {
        Args: {
          p_end_date: string
          p_location_id?: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          invoice_count: number
          total_amount: number
          vendor_name: string
        }[]
      }
      chart_get_associate_performance_metrics: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_provider_type?: string
          p_start_date: string
        }
        Returns: {
          daily_production: number
          performance_percent: number
          planning_avg_daily_production: number
          provider_id: string
          provider_name: string
          rank: number
          target_gap: number
        }[]
      }
      chart_get_production_metrics: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_provider_type?: string
          p_start_date: string
        }
        Returns: {
          avg_daily_production: number
          days_worked: number
          production_amount: number
          provider_id: string
          provider_name: string
          rank: number
        }[]
      }
      chart_get_profit_metrics: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_provider_type?: string
          p_start_date: string
        }
        Returns: {
          periodic_profit: number
          pl_per_day: number
          profit_percent: number
          provider_id: string
          provider_name: string
          rank: number
        }[]
      }
      get_ads_summary: {
        Args: {
          p_from_date: string
          p_organization_id: string
          p_to_date: string
        }
        Returns: {
          average_cpc: number
          cost_per_conversion: number
          total_clicks: number
          total_conversions: number
          total_impressions: number
          total_spend: number
        }[]
      }
      get_auto_processed_percentage: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          auto_processed_percentage: number
          extracted_invoices: number
          total_attachments: number
        }[]
      }
      get_campaign_chart_data: {
        Args: {
          p_from_date: string
          p_organization_id: string
          p_to_date: string
        }
        Returns: {
          report_date: string
          total_clicks: number
          total_conversions: number
          total_impressions: number
          total_spend: number
        }[]
      }
      get_campaign_totals: {
        Args: {
          p_from_date: string
          p_organization_id: string
          p_to_date: string
        }
        Returns: {
          avg_cost_per_conversion: number
          avg_cpc: number
          avg_ctr: number
          campaign_id: string
          campaign_name: string
          campaign_status: string
          campaign_type: string
          total_clicks: number
          total_conversions: number
          total_impressions: number
          total_spend: number
        }[]
      }
      get_categories_with_treatments: {
        Args: { p_organization_id: string }
        Returns: {
          category_created_at: string
          category_description: string
          category_external_id: number
          category_id: string
          category_location_id: string
          category_name: string
          category_region_id: string
          category_updated_at: string
          display_order: number
          duration_minutes: number
          insurance_classification: string
          is_active: boolean
          nhs_band: string
          nhs_price: number
          nhs_treatment_cat: string
          nomenclature: string
          organization_id: string
          owner: string
          patient_description: string
          patient_nomenclature: string
          price: number
          private_price: number
          region: string
          requires_followup: boolean
          treatment_category_id: string
          treatment_code: string
          treatment_created_at: string
          treatment_description: string
          treatment_external_id: number
          treatment_id: string
          treatment_name: string
          treatment_notes: string
          treatment_type: string
          treatment_updated_at: string
          uda_band: string
        }[]
      }
      get_categories_with_treatments_json: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_practitioner_activity_report: {
        Args: {
          p_from_date: string
          p_organization_id: string
          p_payment_plan_ids?: string
          p_practitioner_ids?: string
          p_to_date: string
          p_treatment_category_ids?: string
          p_treatment_ids?: string
        }
        Returns: {
          completed_date: string
          duration: number
          invoice_date: string
          invoice_status: string
          paid_on: string
          patient_name: string
          payment_plan: string
          practitioner: string
          price: number
          referrer: string
          treatment: string
        }[]
      }
      get_practitioner_activity_report_v2: {
        Args: {
          p_from_date: string
          p_organization_id: string
          p_payment_plan_ids?: string
          p_practitioner_ids?: string
          p_to_date: string
          p_treatment_category_ids?: string
          p_treatment_ids?: string
        }
        Returns: {
          duration: number
          invoice_date: string
          invoice_status: string
          invoiced_on: string
          paid_on: string
          patient_name: string
          payment_plan: string
          practitioner: string
          price: number
          referrer: string
          treatment: string
          treatment_category: string
        }[]
      }
      get_practitioner_activity_report_kd1: {
        Args: {
          p_organization_id: string
          p_from_date: string
          p_to_date: string
          p_treatment_ids?: string
          p_practitioner_ids?: string
          p_treatment_category_ids?: string
          p_payment_plan_ids?: string
          p_location_ids?: string[]
          p_paid_only?: boolean
        }
        Returns: {
          completed_date: string
          patient_name: string
          treatment: string
          treatment_category: string
          practitioner: string
          referrer: string | null
          payment_plan: string
          duration: number
          price: number
          invoiced_on: string | null
          paid_on: string | null
          invoice_status: string
        }[]
      }
      get_processing_efficiency_metrics: {
        Args: {
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: {
          auto_processed_percentage: number
          avg_data_accuracy: number
          avg_days_to_pay: number
          extracted_invoices: number
          paid_invoices_count: number
          total_attachments: number
          total_paid_amount: number
        }[]
      }
      get_provider_net_production_monthly: {
        Args: {
          p_from_date: string
          p_location_id?: string
          p_organization_id: string
          p_practitioner_id: number
          p_to_date: string
        }
        Returns: {
          membership_amount: number
          month: string
          nhs_amount: number
          private_amount: number
          total_amount: number
        }[]
      }
      get_setup_category_payment_plan_ids: {
        Args: {
          p_bucket?: string
          p_location_id?: string
          p_organization_id: string
        }
        Returns: number[]
      }
      get_setup_category_private_payment_plan_ids: {
        Args: {
          p_location_id?: string
          p_organization_id: string
        }
        Returns: number[]
      }
      get_provider_working_hours_monthly: {
        Args: {
          p_from_date: string
          p_organization_id: string
          p_practitioner_id: number
          p_to_date: string
        }
        Returns: {
          appointment_count: number
          month: string
          total_hours: number
        }[]
      }
      has_org_role: {
        Args: {
          _organization_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      soft_delete_region: {
        Args: { _organization_id: string; _region_id: string }
        Returns: undefined
      }
      user_in_org: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      accounting_platform: "iplicit"
      app_role: "owner" | "admin" | "member"
      connection_status: "connected" | "disconnected" | "error" | "pending_auth"
      line_item_approval_status: "pending" | "approved" | "rejected"
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
      accounting_platform: ["iplicit"],
      app_role: ["owner", "admin", "member"],
      connection_status: ["connected", "disconnected", "error", "pending_auth"],
      line_item_approval_status: ["pending", "approved", "rejected"],
    },
  },
} as const
