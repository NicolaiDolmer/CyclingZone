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
      achievements: {
        Row: {
          category: string
          description: string
          icon: string
          id: string
          is_secret: boolean | null
          sort_order: number | null
          title: string
        }
        Insert: {
          category: string
          description: string
          icon?: string
          id: string
          is_secret?: boolean | null
          sort_order?: number | null
          title: string
        }
        Update: {
          category?: string
          description?: string
          icon?: string
          id?: string
          is_secret?: boolean | null
          sort_order?: number | null
          title?: string
        }
        Relationships: []
      }
      activity_feed: {
        Row: {
          amount: number | null
          created_at: string | null
          id: string
          meta: Json | null
          rider_id: string | null
          rider_name: string | null
          team_id: string | null
          team_name: string | null
          type: string
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          id?: string
          meta?: Json | null
          rider_id?: string | null
          rider_name?: string | null
          team_id?: string | null
          team_name?: string | null
          type: string
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          id?: string
          meta?: Json | null
          rider_id?: string | null
          rider_name?: string | null
          team_id?: string | null
          team_name?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_feed_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_feed_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_log: {
        Row: {
          action_type: string
          admin_user_id: string
          created_at: string | null
          description: string
          id: string
          meta: Json | null
          target_rider_id: string | null
          target_team_id: string | null
        }
        Insert: {
          action_type: string
          admin_user_id: string
          created_at?: string | null
          description: string
          id?: string
          meta?: Json | null
          target_rider_id?: string | null
          target_team_id?: string | null
        }
        Update: {
          action_type?: string
          admin_user_id?: string
          created_at?: string | null
          description?: string
          id?: string
          meta?: Json | null
          target_rider_id?: string | null
          target_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_log_target_rider_id_fkey"
            columns: ["target_rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_log_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_bids: {
        Row: {
          amount: number
          auction_id: string
          bid_time: string | null
          id: string
          team_id: string
          triggered_extension: boolean | null
        }
        Insert: {
          amount: number
          auction_id: string
          bid_time?: string | null
          id?: string
          team_id: string
          triggered_extension?: boolean | null
        }
        Update: {
          amount?: number
          auction_id?: string
          bid_time?: string | null
          id?: string
          team_id?: string
          triggered_extension?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "auction_bids_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_bids_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_timing_config: {
        Row: {
          duration_hours: number
          extension_minutes: number
          id: number
          updated_at: string | null
          weekday_close_hour: number
          weekday_open_hour: number
          weekend_close_hour: number
          weekend_open_hour: number
        }
        Insert: {
          duration_hours?: number
          extension_minutes?: number
          id?: number
          updated_at?: string | null
          weekday_close_hour?: number
          weekday_open_hour?: number
          weekend_close_hour?: number
          weekend_open_hour?: number
        }
        Update: {
          duration_hours?: number
          extension_minutes?: number
          id?: number
          updated_at?: string | null
          weekday_close_hour?: number
          weekday_open_hour?: number
          weekend_close_hour?: number
          weekend_open_hour?: number
        }
        Relationships: []
      }
      auctions: {
        Row: {
          actual_end: string | null
          calculated_end: string
          created_at: string | null
          current_bidder_id: string | null
          current_price: number
          extension_count: number | null
          guaranteed_price: number | null
          id: string
          is_guaranteed_sale: boolean | null
          min_increment: number | null
          requested_start: string
          rider_id: string
          seller_team_id: string | null
          starting_price: number
          status: string | null
        }
        Insert: {
          actual_end?: string | null
          calculated_end: string
          created_at?: string | null
          current_bidder_id?: string | null
          current_price?: number
          extension_count?: number | null
          guaranteed_price?: number | null
          id?: string
          is_guaranteed_sale?: boolean | null
          min_increment?: number | null
          requested_start?: string
          rider_id: string
          seller_team_id?: string | null
          starting_price?: number
          status?: string | null
        }
        Update: {
          actual_end?: string | null
          calculated_end?: string
          created_at?: string | null
          current_bidder_id?: string | null
          current_price?: number
          extension_count?: number | null
          guaranteed_price?: number | null
          id?: string
          is_guaranteed_sale?: boolean | null
          min_increment?: number | null
          requested_start?: string
          rider_id?: string
          seller_team_id?: string | null
          starting_price?: number
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auctions_current_bidder_id_fkey"
            columns: ["current_bidder_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_seller_team_id_fkey"
            columns: ["seller_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      board_plan_snapshots: {
        Row: {
          board_id: string
          created_at: string | null
          division_rank: number | null
          gc_wins: number
          goals_met: number
          goals_total: number
          id: string
          satisfaction_delta: number | null
          season_id: string
          season_number: number
          season_within_plan: number
          stage_wins: number
          team_id: string
        }
        Insert: {
          board_id: string
          created_at?: string | null
          division_rank?: number | null
          gc_wins?: number
          goals_met?: number
          goals_total?: number
          id?: string
          satisfaction_delta?: number | null
          season_id: string
          season_number: number
          season_within_plan: number
          stage_wins?: number
          team_id: string
        }
        Update: {
          board_id?: string
          created_at?: string | null
          division_rank?: number | null
          gc_wins?: number
          goals_met?: number
          goals_total?: number
          id?: string
          satisfaction_delta?: number | null
          season_id?: string
          season_number?: number
          season_within_plan?: number
          stage_wins?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_plan_snapshots_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_plan_snapshots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "board_plan_snapshots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_plan_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      board_profiles: {
        Row: {
          budget_modifier: number | null
          created_at: string | null
          cumulative_gc_wins: number
          cumulative_stage_wins: number
          current_goals: Json | null
          focus: string | null
          id: string
          negotiated_at: string | null
          negotiation_rounds: number | null
          negotiation_status: string | null
          plan_end_season_number: number | null
          plan_start_balance: number | null
          plan_start_season_number: number | null
          plan_start_sponsor_income: number | null
          plan_type: string | null
          proposed_goals: Json | null
          satisfaction: number | null
          season_id: string | null
          seasons_completed: number
          team_id: string
          updated_at: string | null
        }
        Insert: {
          budget_modifier?: number | null
          created_at?: string | null
          cumulative_gc_wins?: number
          cumulative_stage_wins?: number
          current_goals?: Json | null
          focus?: string | null
          id?: string
          negotiated_at?: string | null
          negotiation_rounds?: number | null
          negotiation_status?: string | null
          plan_end_season_number?: number | null
          plan_start_balance?: number | null
          plan_start_season_number?: number | null
          plan_start_sponsor_income?: number | null
          plan_type?: string | null
          proposed_goals?: Json | null
          satisfaction?: number | null
          season_id?: string | null
          seasons_completed?: number
          team_id: string
          updated_at?: string | null
        }
        Update: {
          budget_modifier?: number | null
          created_at?: string | null
          cumulative_gc_wins?: number
          cumulative_stage_wins?: number
          current_goals?: Json | null
          focus?: string | null
          id?: string
          negotiated_at?: string | null
          negotiation_rounds?: number | null
          negotiation_status?: string | null
          plan_end_season_number?: number | null
          plan_start_balance?: number | null
          plan_start_season_number?: number | null
          plan_start_sponsor_income?: number | null
          plan_type?: string | null
          proposed_goals?: Json | null
          satisfaction?: number | null
          season_id?: string | null
          seasons_completed?: number
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "board_profiles_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "board_profiles_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      board_request_log: {
        Row: {
          board_changes: Json
          board_id: string
          created_at: string | null
          id: string
          outcome: string
          request_payload: Json
          request_type: string
          season_id: string | null
          season_number: number | null
          summary: string
          team_id: string
          title: string
          tradeoff_summary: string | null
        }
        Insert: {
          board_changes?: Json
          board_id: string
          created_at?: string | null
          id?: string
          outcome: string
          request_payload?: Json
          request_type: string
          season_id?: string | null
          season_number?: number | null
          summary: string
          team_id: string
          title: string
          tradeoff_summary?: string | null
        }
        Update: {
          board_changes?: Json
          board_id?: string
          created_at?: string | null
          id?: string
          outcome?: string
          request_payload?: Json
          request_type?: string
          season_id?: string | null
          season_number?: number | null
          summary?: string
          team_id?: string
          title?: string
          tradeoff_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "board_request_log_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_request_log_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "board_request_log_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_request_log_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      discord_settings: {
        Row: {
          created_at: string | null
          id: string
          is_default: boolean | null
          webhook_name: string
          webhook_type: string
          webhook_url: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          webhook_name: string
          webhook_type?: string
          webhook_url: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          webhook_name?: string
          webhook_type?: string
          webhook_url?: string
        }
        Relationships: []
      }
      finance_transactions: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          id: string
          race_id: string | null
          season_id: string | null
          team_id: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          description?: string | null
          id?: string
          race_id?: string | null
          season_id?: string | null
          team_id: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          race_id?: string | null
          season_id?: string | null
          team_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "finance_transactions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      hall_of_fame: {
        Row: {
          category: string
          id: string
          recorded_at: string | null
          season_id: string | null
          season_number: number | null
          team_id: string | null
          team_name: string | null
          value: number
        }
        Insert: {
          category: string
          id?: string
          recorded_at?: string | null
          season_id?: string | null
          season_number?: number | null
          team_id?: string | null
          team_name?: string | null
          value: number
        }
        Update: {
          category?: string
          id?: string
          recorded_at?: string | null
          season_id?: string | null
          season_number?: number | null
          team_id?: string | null
          team_name?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "hall_of_fame_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "hall_of_fame_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hall_of_fame_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      import_log: {
        Row: {
          created_at: string | null
          errors: Json | null
          filename: string | null
          id: string
          import_type: string
          imported_by: string | null
          rows_inserted: number | null
          rows_processed: number | null
          rows_updated: number | null
        }
        Insert: {
          created_at?: string | null
          errors?: Json | null
          filename?: string | null
          id?: string
          import_type: string
          imported_by?: string | null
          rows_inserted?: number | null
          rows_processed?: number | null
          rows_updated?: number | null
        }
        Update: {
          created_at?: string | null
          errors?: Json | null
          filename?: string | null
          id?: string
          import_type?: string
          imported_by?: string | null
          rows_inserted?: number | null
          rows_processed?: number | null
          rows_updated?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_log_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_agreements: {
        Row: {
          buy_option_price: number | null
          created_at: string | null
          end_season: number
          from_team_id: string
          id: string
          loan_fee: number
          rider_id: string
          start_season: number
          status: string
          to_team_id: string
          updated_at: string | null
        }
        Insert: {
          buy_option_price?: number | null
          created_at?: string | null
          end_season: number
          from_team_id: string
          id?: string
          loan_fee?: number
          rider_id: string
          start_season: number
          status?: string
          to_team_id: string
          updated_at?: string | null
        }
        Update: {
          buy_option_price?: number | null
          created_at?: string | null
          end_season?: number
          from_team_id?: string
          id?: string
          loan_fee?: number
          rider_id?: string
          start_season?: number
          status?: string
          to_team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_agreements_from_team_id_fkey"
            columns: ["from_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_agreements_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_agreements_to_team_id_fkey"
            columns: ["to_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_config: {
        Row: {
          debt_ceiling: number
          division: number
          id: string
          interest_rate_pct: number
          loan_type: string
          origination_fee_pct: number
          seasons: number
          updated_at: string | null
        }
        Insert: {
          debt_ceiling: number
          division: number
          id?: string
          interest_rate_pct: number
          loan_type: string
          origination_fee_pct: number
          seasons: number
          updated_at?: string | null
        }
        Update: {
          debt_ceiling?: number
          division?: number
          id?: string
          interest_rate_pct?: number
          loan_type?: string
          origination_fee_pct?: number
          seasons?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      loans: {
        Row: {
          amount_remaining: number
          created_at: string | null
          id: string
          interest_rate: number
          loan_type: string
          origination_fee: number
          principal: number
          seasons_remaining: number
          seasons_total: number
          status: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          amount_remaining: number
          created_at?: string | null
          id?: string
          interest_rate: number
          loan_type: string
          origination_fee: number
          principal: number
          seasons_remaining: number
          seasons_total: number
          status?: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          amount_remaining?: number
          created_at?: string | null
          id?: string
          interest_rate?: number
          loan_type?: string
          origination_fee?: number
          principal?: number
          seasons_remaining?: number
          seasons_total?: number
          status?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_achievements: {
        Row: {
          achievement_id: string
          id: string
          unlocked_at: string | null
          user_id: string
        }
        Insert: {
          achievement_id: string
          id?: string
          unlocked_at?: string | null
          user_id: string
        }
        Update: {
          achievement_id?: string
          id?: string
          unlocked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          related_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          related_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          related_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_race_result_rows: {
        Row: {
          id: string
          pending_id: string | null
          rank: number
          result_type: string
          rider_id: string | null
          stage_number: number | null
        }
        Insert: {
          id?: string
          pending_id?: string | null
          rank: number
          result_type: string
          rider_id?: string | null
          stage_number?: number | null
        }
        Update: {
          id?: string
          pending_id?: string | null
          rank?: number
          result_type?: string
          rider_id?: string | null
          stage_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_race_result_rows_pending_id_fkey"
            columns: ["pending_id"]
            isOneToOne: false
            referencedRelation: "pending_race_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_race_result_rows_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_race_results: {
        Row: {
          admin_note: string | null
          id: string
          race_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          admin_note?: string | null
          id?: string
          race_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          admin_note?: string | null
          id?: string
          race_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_race_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      prize_tables: {
        Row: {
          id: string
          prize_amount: number
          race_type: string
          rank: number
          result_type: string
        }
        Insert: {
          id?: string
          prize_amount?: number
          race_type: string
          rank: number
          result_type: string
        }
        Update: {
          id?: string
          prize_amount?: number
          race_type?: string
          rank?: number
          result_type?: string
        }
        Relationships: []
      }
      race_classes: {
        Row: {
          category: number
          class_key: string
          display_name: string
          id: string
          race_type: string
        }
        Insert: {
          category: number
          class_key: string
          display_name: string
          id?: string
          race_type: string
        }
        Update: {
          category?: number
          class_key?: string
          display_name?: string
          id?: string
          race_type?: string
        }
        Relationships: []
      }
      race_points: {
        Row: {
          id: string
          points: number
          race_class: string
          rank: number
          result_type: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          points?: number
          race_class: string
          rank: number
          result_type: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          points?: number
          race_class?: string
          rank?: number
          result_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      race_results: {
        Row: {
          finish_time: string | null
          id: string
          imported_at: string | null
          points_earned: number | null
          prize_money: number | null
          race_id: string | null
          rank: number | null
          result_type: string
          rider_id: string | null
          rider_name: string | null
          stage_number: number | null
          team_id: string | null
          team_name: string | null
        }
        Insert: {
          finish_time?: string | null
          id?: string
          imported_at?: string | null
          points_earned?: number | null
          prize_money?: number | null
          race_id?: string | null
          rank?: number | null
          result_type: string
          rider_id?: string | null
          rider_name?: string | null
          stage_number?: number | null
          team_id?: string | null
          team_name?: string | null
        }
        Update: {
          finish_time?: string | null
          id?: string
          imported_at?: string | null
          points_earned?: number | null
          prize_money?: number | null
          race_id?: string | null
          rank?: number | null
          result_type?: string
          rider_id?: string | null
          rider_name?: string | null
          stage_number?: number | null
          team_id?: string | null
          team_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "race_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_results_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_results_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          created_at: string | null
          id: string
          name: string
          prize_paid_at: string | null
          prize_pool: number | null
          race_class: string | null
          race_type: string | null
          season_id: string | null
          stages: number | null
          start_date: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          prize_paid_at?: string | null
          prize_pool?: number | null
          race_class?: string | null
          race_type?: string | null
          season_id?: string | null
          stages?: number | null
          start_date?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          prize_paid_at?: string | null
          prize_pool?: number | null
          race_class?: string | null
          race_type?: string | null
          season_id?: string | null
          stages?: number | null
          start_date?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "races_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "races_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_stat_history: {
        Row: {
          height: number | null
          id: string
          popularity: number | null
          rider_id: string
          stat_acc: number | null
          stat_bj: number | null
          stat_bk: number | null
          stat_bro: number | null
          stat_fl: number | null
          stat_ftr: number | null
          stat_kb: number | null
          stat_mod: number | null
          stat_ned: number | null
          stat_prl: number | null
          stat_res: number | null
          stat_sp: number | null
          stat_tt: number | null
          stat_udh: number | null
          synced_at: string
          weight: number | null
        }
        Insert: {
          height?: number | null
          id?: string
          popularity?: number | null
          rider_id: string
          stat_acc?: number | null
          stat_bj?: number | null
          stat_bk?: number | null
          stat_bro?: number | null
          stat_fl?: number | null
          stat_ftr?: number | null
          stat_kb?: number | null
          stat_mod?: number | null
          stat_ned?: number | null
          stat_prl?: number | null
          stat_res?: number | null
          stat_sp?: number | null
          stat_tt?: number | null
          stat_udh?: number | null
          synced_at?: string
          weight?: number | null
        }
        Update: {
          height?: number | null
          id?: string
          popularity?: number | null
          rider_id?: string
          stat_acc?: number | null
          stat_bj?: number | null
          stat_bk?: number | null
          stat_bro?: number | null
          stat_fl?: number | null
          stat_ftr?: number | null
          stat_kb?: number | null
          stat_mod?: number | null
          stat_ned?: number | null
          stat_prl?: number | null
          stat_res?: number | null
          stat_sp?: number | null
          stat_tt?: number | null
          stat_udh?: number | null
          synced_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_stat_history_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_uci_history: {
        Row: {
          id: string
          rider_id: string
          synced_at: string
          uci_points: number
        }
        Insert: {
          id?: string
          rider_id: string
          synced_at?: string
          uci_points: number
        }
        Update: {
          id?: string
          rider_id?: string
          synced_at?: string
          uci_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "rider_uci_history_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_watchlist: {
        Row: {
          created_at: string | null
          id: string
          note: string | null
          rider_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          note?: string | null
          rider_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          note?: string | null
          rider_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_watchlist_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      riders: {
        Row: {
          ai_team_id: string | null
          birthdate: string | null
          created_at: string | null
          firstname: string
          height: number | null
          id: string
          is_u25: boolean | null
          lastname: string
          market_value: number | null
          nationality_code: string | null
          pcm_id: number | null
          pending_team_id: string | null
          popularity: number | null
          potentiale: number | null
          price: number | null
          prize_earnings_bonus: number
          salary: number | null
          stat_acc: number | null
          stat_bj: number | null
          stat_bk: number | null
          stat_bro: number | null
          stat_fl: number | null
          stat_ftr: number | null
          stat_kb: number | null
          stat_mod: number | null
          stat_ned: number | null
          stat_prl: number | null
          stat_res: number | null
          stat_sp: number | null
          stat_tt: number | null
          stat_udh: number | null
          team_id: string | null
          uci_points: number | null
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          ai_team_id?: string | null
          birthdate?: string | null
          created_at?: string | null
          firstname: string
          height?: number | null
          id?: string
          is_u25?: boolean | null
          lastname: string
          market_value?: number | null
          nationality_code?: string | null
          pcm_id?: number | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          price?: number | null
          prize_earnings_bonus?: number
          salary?: number | null
          stat_acc?: number | null
          stat_bj?: number | null
          stat_bk?: number | null
          stat_bro?: number | null
          stat_fl?: number | null
          stat_ftr?: number | null
          stat_kb?: number | null
          stat_mod?: number | null
          stat_ned?: number | null
          stat_prl?: number | null
          stat_res?: number | null
          stat_sp?: number | null
          stat_tt?: number | null
          stat_udh?: number | null
          team_id?: string | null
          uci_points?: number | null
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          ai_team_id?: string | null
          birthdate?: string | null
          created_at?: string | null
          firstname?: string
          height?: number | null
          id?: string
          is_u25?: boolean | null
          lastname?: string
          market_value?: number | null
          nationality_code?: string | null
          pcm_id?: number | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          price?: number | null
          prize_earnings_bonus?: number
          salary?: number | null
          stat_acc?: number | null
          stat_bj?: number | null
          stat_bk?: number | null
          stat_bro?: number | null
          stat_fl?: number | null
          stat_ftr?: number | null
          stat_kb?: number | null
          stat_mod?: number | null
          stat_ned?: number | null
          stat_prl?: number | null
          stat_res?: number | null
          stat_sp?: number | null
          stat_tt?: number | null
          stat_udh?: number | null
          team_id?: string | null
          uci_points?: number | null
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "riders_ai_team_id_fkey"
            columns: ["ai_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riders_pending_team_id_fkey"
            columns: ["pending_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      season_standings: {
        Row: {
          division: number
          gc_wins: number | null
          id: string
          races_completed: number | null
          rank_in_division: number | null
          season_id: string
          stage_wins: number | null
          team_id: string
          total_points: number | null
          updated_at: string | null
        }
        Insert: {
          division: number
          gc_wins?: number | null
          id?: string
          races_completed?: number | null
          rank_in_division?: number | null
          season_id: string
          stage_wins?: number | null
          team_id: string
          total_points?: number | null
          updated_at?: string | null
        }
        Update: {
          division?: number
          gc_wins?: number | null
          id?: string
          races_completed?: number | null
          rank_in_division?: number | null
          season_id?: string
          stage_wins?: number | null
          team_id?: string
          total_points?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "season_standings_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "season_standings_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_standings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string | null
          end_date: string | null
          id: string
          number: number
          race_days_completed: number | null
          race_days_total: number | null
          start_date: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          number: number
          race_days_completed?: number | null
          race_days_total?: number | null
          start_date?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          number?: number
          race_days_completed?: number | null
          race_days_total?: number | null
          start_date?: string | null
          status?: string | null
        }
        Relationships: []
      }
      swap_offers: {
        Row: {
          cash_adjustment: number
          counter_cash: number | null
          created_at: string | null
          id: string
          message: string | null
          offered_rider_id: string
          proposing_confirmed: boolean
          proposing_team_id: string
          receiving_confirmed: boolean
          receiving_team_id: string
          requested_rider_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          cash_adjustment?: number
          counter_cash?: number | null
          created_at?: string | null
          id?: string
          message?: string | null
          offered_rider_id: string
          proposing_confirmed?: boolean
          proposing_team_id: string
          receiving_confirmed?: boolean
          receiving_team_id: string
          requested_rider_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          cash_adjustment?: number
          counter_cash?: number | null
          created_at?: string | null
          id?: string
          message?: string | null
          offered_rider_id?: string
          proposing_confirmed?: boolean
          proposing_team_id?: string
          receiving_confirmed?: boolean
          receiving_team_id?: string
          requested_rider_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swap_offers_offered_rider_id_fkey"
            columns: ["offered_rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_offers_proposing_team_id_fkey"
            columns: ["proposing_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_offers_receiving_team_id_fkey"
            columns: ["receiving_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_offers_requested_rider_id_fkey"
            columns: ["requested_rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          ai_source_id: number | null
          balance: number | null
          created_at: string | null
          division: number | null
          id: string
          is_ai: boolean | null
          is_bank: boolean | null
          is_frozen: boolean | null
          manager_name: string | null
          name: string
          sponsor_income: number | null
          user_id: string | null
        }
        Insert: {
          ai_source_id?: number | null
          balance?: number | null
          created_at?: string | null
          division?: number | null
          id?: string
          is_ai?: boolean | null
          is_bank?: boolean | null
          is_frozen?: boolean | null
          manager_name?: string | null
          name: string
          sponsor_income?: number | null
          user_id?: string | null
        }
        Update: {
          ai_source_id?: number | null
          balance?: number | null
          created_at?: string | null
          division?: number | null
          id?: string
          is_ai?: boolean | null
          is_bank?: boolean | null
          is_frozen?: boolean | null
          manager_name?: string | null
          name?: string
          sponsor_income?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_listings: {
        Row: {
          asking_price: number
          created_at: string | null
          id: string
          rider_id: string
          seller_team_id: string
          status: string | null
        }
        Insert: {
          asking_price: number
          created_at?: string | null
          id?: string
          rider_id: string
          seller_team_id: string
          status?: string | null
        }
        Update: {
          asking_price?: number
          created_at?: string | null
          id?: string
          rider_id?: string
          seller_team_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfer_listings_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_listings_seller_team_id_fkey"
            columns: ["seller_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_offers: {
        Row: {
          buyer_archived_at: string | null
          buyer_confirmed: boolean
          buyer_team_id: string
          counter_amount: number | null
          created_at: string | null
          expires_at: string | null
          id: string
          last_action_by: string | null
          listing_id: string | null
          message: string | null
          offer_amount: number
          rider_id: string | null
          round: number | null
          seller_archived_at: string | null
          seller_confirmed: boolean
          seller_team_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          buyer_archived_at?: string | null
          buyer_confirmed?: boolean
          buyer_team_id: string
          counter_amount?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_action_by?: string | null
          listing_id?: string | null
          message?: string | null
          offer_amount: number
          rider_id?: string | null
          round?: number | null
          seller_archived_at?: string | null
          seller_confirmed?: boolean
          seller_team_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          buyer_archived_at?: string | null
          buyer_confirmed?: boolean
          buyer_team_id?: string
          counter_amount?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_action_by?: string | null
          listing_id?: string | null
          message?: string | null
          offer_amount?: number
          rider_id?: string | null
          round?: number | null
          seller_archived_at?: string | null
          seller_confirmed?: boolean
          seller_team_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfer_offers_buyer_team_id_fkey"
            columns: ["buyer_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_offers_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "transfer_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_offers_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_offers_seller_team_id_fkey"
            columns: ["seller_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_windows: {
        Row: {
          closed_at: string | null
          created_at: string | null
          id: string
          opened_at: string | null
          season_id: string | null
          status: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string | null
          id?: string
          opened_at?: string | null
          season_id?: string | null
          status?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string | null
          id?: string
          opened_at?: string | null
          season_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfer_windows_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "transfer_windows_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          discord_id: string | null
          email: string
          id: string
          last_login_date: string | null
          last_seen: string | null
          level: number | null
          login_streak: number | null
          role: string
          username: string
          xp: number | null
        }
        Insert: {
          created_at?: string | null
          discord_id?: string | null
          email: string
          id?: string
          last_login_date?: string | null
          last_seen?: string | null
          level?: number | null
          login_streak?: number | null
          role?: string
          username: string
          xp?: number | null
        }
        Update: {
          created_at?: string | null
          discord_id?: string | null
          email?: string
          id?: string
          last_login_date?: string | null
          last_seen?: string | null
          level?: number | null
          login_streak?: number | null
          role?: string
          username?: string
          xp?: number | null
        }
        Relationships: []
      }
      xp_log: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          reason: string
          user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          reason: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          reason?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      ai_active_season_status: {
        Row: {
          prize_transaction_count: number | null
          race_count: number | null
          race_days_completed: number | null
          race_days_total: number | null
          race_result_count: number | null
          season_id: string | null
          season_number: number | null
          standings_count: number | null
          status: string | null
        }
        Relationships: []
      }
      ai_race_import_blockers: {
        Row: {
          created_at: string | null
          errors: Json | null
          import_log_id: string | null
          rows_inserted: number | null
          rows_processed: number | null
          rows_updated: number | null
          status: string | null
        }
        Relationships: []
      }
      ai_recent_import_health: {
        Row: {
          created_at: string | null
          error_count: number | null
          id: string | null
          import_type: string | null
          rows_inserted: number | null
          rows_processed: number | null
          rows_updated: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      increment_balance: {
        Args: { amount: number; team_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
