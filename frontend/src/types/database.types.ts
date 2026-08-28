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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      academy_graduation: {
        Row: {
          created_at: string
          deadline: string
          id: string
          resolved_at: string | null
          rider_id: string
          season_id: string
          status: string
          team_id: string
        }
        Insert: {
          created_at?: string
          deadline: string
          id?: string
          resolved_at?: string | null
          rider_id: string
          season_id: string
          status?: string
          team_id: string
        }
        Update: {
          created_at?: string
          deadline?: string
          id?: string
          resolved_at?: string | null
          rider_id?: string
          season_id?: string
          status?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_graduation_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_graduation_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "academy_graduation_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_graduation_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "academy_graduation_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_intake: {
        Row: {
          created_at: string
          id: string
          is_serious: boolean
          resolved_at: string | null
          rider_id: string
          season_id: string
          signing_fee: number | null
          status: string
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_serious?: boolean
          resolved_at?: string | null
          rider_id: string
          season_id: string
          signing_fee?: number | null
          status?: string
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_serious?: boolean
          resolved_at?: string | null
          rider_id?: string
          season_id?: string
          signing_fee?: number | null
          status?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_intake_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_intake_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "academy_intake_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_intake_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "academy_intake_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_intake_ticks: {
        Row: {
          created_at: string
          team_id: string
          tick_date: string
        }
        Insert: {
          created_at?: string
          team_id: string
          tick_date: string
        }
        Update: {
          created_at?: string
          team_id?: string
          tick_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_intake_ticks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "academy_intake_ticks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_season_intake_runs: {
        Row: {
          created_at: string
          season_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          season_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          season_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_season_intake_runs_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "academy_season_intake_runs_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_season_intake_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "academy_season_intake_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
          admin_user_id: string | null
          created_at: string | null
          description: string
          id: string
          meta: Json | null
          target_rider_id: string | null
          target_team_id: string | null
        }
        Insert: {
          action_type: string
          admin_user_id?: string | null
          created_at?: string | null
          description: string
          id?: string
          meta?: Json | null
          target_rider_id?: string | null
          target_team_id?: string | null
        }
        Update: {
          action_type?: string
          admin_user_id?: string | null
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      ai_recovery_runs: {
        Row: {
          created_at: string
          riders_recovered: number
          team_id: string
          tick_date: string
        }
        Insert: {
          created_at?: string
          riders_recovered?: number
          team_id: string
          tick_date: string
        }
        Update: {
          created_at?: string
          riders_recovered?: number
          team_id?: string
          tick_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_recovery_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "ai_recovery_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      auction_bids: {
        Row: {
          amount: number
          auction_id: string
          bid_time: string | null
          id: string
          is_proxy: boolean
          team_id: string
          triggered_extension: boolean | null
        }
        Insert: {
          amount: number
          auction_id: string
          bid_time?: string | null
          id?: string
          is_proxy?: boolean
          team_id: string
          triggered_extension?: boolean | null
        }
        Update: {
          amount?: number
          auction_id?: string
          bid_time?: string | null
          id?: string
          is_proxy?: boolean
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      auction_proxy_bids: {
        Row: {
          auction_id: string
          created_at: string | null
          id: string
          max_amount: number
          team_id: string
        }
        Insert: {
          auction_id: string
          created_at?: string | null
          id?: string
          max_amount: number
          team_id: string
        }
        Update: {
          auction_id?: string
          created_at?: string | null
          id?: string
          max_amount?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_proxy_bids_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_proxy_bids_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "auction_proxy_bids_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_timing_config: {
        Row: {
          deadline_day_override: string
          duration_hours: number
          extension_minutes: number
          id: number
          market_pause_level: string
          market_paused_at: string | null
          market_paused_reason: string | null
          updated_at: string | null
          weekday_close_hour: number
          weekday_open_hour: number
          weekend_close_hour: number
          weekend_open_hour: number
        }
        Insert: {
          deadline_day_override?: string
          duration_hours?: number
          extension_minutes?: number
          id?: number
          market_pause_level?: string
          market_paused_at?: string | null
          market_paused_reason?: string | null
          updated_at?: string | null
          weekday_close_hour?: number
          weekday_open_hour?: number
          weekend_close_hour?: number
          weekend_open_hour?: number
        }
        Update: {
          deadline_day_override?: string
          duration_hours?: number
          extension_minutes?: number
          id?: number
          market_pause_level?: string
          market_paused_at?: string | null
          market_paused_reason?: string | null
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
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          created_at: string | null
          current_bidder_id: string | null
          current_price: number
          expired_intake_team_id: string | null
          extension_count: number | null
          guaranteed_price: number | null
          id: string
          is_flash: boolean
          is_guaranteed_sale: boolean | null
          is_youth: boolean
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
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string | null
          current_bidder_id?: string | null
          current_price?: number
          expired_intake_team_id?: string | null
          extension_count?: number | null
          guaranteed_price?: number | null
          id?: string
          is_flash?: boolean
          is_guaranteed_sale?: boolean | null
          is_youth?: boolean
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
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string | null
          current_bidder_id?: string | null
          current_price?: number
          expired_intake_team_id?: string | null
          extension_count?: number | null
          guaranteed_price?: number | null
          id?: string
          is_flash?: boolean
          is_guaranteed_sale?: boolean | null
          is_youth?: boolean
          min_increment?: number | null
          requested_start?: string
          rider_id?: string
          seller_team_id?: string | null
          starting_price?: number
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auctions_cancelled_by_user_id_fkey"
            columns: ["cancelled_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_current_bidder_id_fkey"
            columns: ["current_bidder_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "auctions_current_bidder_id_fkey"
            columns: ["current_bidder_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_expired_intake_team_id_fkey"
            columns: ["expired_intake_team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "auctions_expired_intake_team_id_fkey"
            columns: ["expired_intake_team_id"]
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      backup_2407_20260715_pending_removal: {
        Row: {
          backed_up_at: string | null
          id: string | null
          league_division_id: number | null
          name: string | null
          pending_removal_at: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          league_division_id?: number | null
          name?: string | null
          pending_removal_at?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          league_division_id?: number | null
          name?: string | null
          pending_removal_at?: string | null
        }
        Relationships: []
      }
      backup_2456_derived_20260715: {
        Row: {
          ability_caps: Json | null
          ability_progress: Json | null
          acceleration: number | null
          aggression: number | null
          climbing: number | null
          cobblestone: number | null
          descending: number | null
          durability: number | null
          endurance: number | null
          flat: number | null
          formula_version: number | null
          generated_at: string | null
          hidden_potential: number | null
          positioning: number | null
          prolog: number | null
          punch: number | null
          recovery: number | null
          rider_id: string | null
          season_budget_baseline: Json | null
          season_budget_season: number | null
          sprint: number | null
          tactics: number | null
          tempo: number | null
          time_trial: number | null
        }
        Insert: {
          ability_caps?: Json | null
          ability_progress?: Json | null
          acceleration?: number | null
          aggression?: number | null
          climbing?: number | null
          cobblestone?: number | null
          descending?: number | null
          durability?: number | null
          endurance?: number | null
          flat?: number | null
          formula_version?: number | null
          generated_at?: string | null
          hidden_potential?: number | null
          positioning?: number | null
          prolog?: number | null
          punch?: number | null
          recovery?: number | null
          rider_id?: string | null
          season_budget_baseline?: Json | null
          season_budget_season?: number | null
          sprint?: number | null
          tactics?: number | null
          tempo?: number | null
          time_trial?: number | null
        }
        Update: {
          ability_caps?: Json | null
          ability_progress?: Json | null
          acceleration?: number | null
          aggression?: number | null
          climbing?: number | null
          cobblestone?: number | null
          descending?: number | null
          durability?: number | null
          endurance?: number | null
          flat?: number | null
          formula_version?: number | null
          generated_at?: string | null
          hidden_potential?: number | null
          positioning?: number | null
          prolog?: number | null
          punch?: number | null
          recovery?: number | null
          rider_id?: string | null
          season_budget_baseline?: Json | null
          season_budget_season?: number | null
          sprint?: number | null
          tactics?: number | null
          tempo?: number | null
          time_trial?: number | null
        }
        Relationships: []
      }
      backup_2456_free_youth_20260715: {
        Row: {
          acquired_at: string | null
          ai_team_id: string | null
          base_value: number | null
          birthdate: string | null
          contract_end_season: number | null
          contract_length: number | null
          created_at: string | null
          firstname: string | null
          height: number | null
          id: string | null
          is_academy: boolean | null
          is_retired: boolean | null
          is_u25: boolean | null
          lastname: string | null
          market_value: number | null
          nationality_code: string | null
          owner_is_ai: boolean | null
          pcm_id: number | null
          pending_team_id: string | null
          popularity: number | null
          potentiale: number | null
          primary_type: string | null
          prize_earnings_bonus: number | null
          salary: number | null
          secondary_type: string | null
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
          acquired_at?: string | null
          ai_team_id?: string | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          firstname?: string | null
          height?: number | null
          id?: string | null
          is_academy?: boolean | null
          is_retired?: boolean | null
          is_u25?: boolean | null
          lastname?: string | null
          market_value?: number | null
          nationality_code?: string | null
          owner_is_ai?: boolean | null
          pcm_id?: number | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number | null
          salary?: number | null
          secondary_type?: string | null
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
          acquired_at?: string | null
          ai_team_id?: string | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          firstname?: string | null
          height?: number | null
          id?: string | null
          is_academy?: boolean | null
          is_retired?: boolean | null
          is_u25?: boolean | null
          lastname?: string | null
          market_value?: number | null
          nationality_code?: string | null
          owner_is_ai?: boolean | null
          pcm_id?: number | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number | null
          salary?: number | null
          secondary_type?: string | null
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
        Relationships: []
      }
      backup_2456_watchlist_20260715: {
        Row: {
          created_at: string | null
          id: string | null
          note: string | null
          rider_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          note?: string | null
          rider_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          note?: string | null
          rider_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      backup_2590_season_budget_20260719: {
        Row: {
          backed_up_at: string
          rider_id: string
          season_budget_baseline: Json | null
          season_budget_season: number | null
        }
        Insert: {
          backed_up_at?: string
          rider_id: string
          season_budget_baseline?: Json | null
          season_budget_season?: number | null
        }
        Update: {
          backed_up_at?: string
          rider_id?: string
          season_budget_baseline?: Json | null
          season_budget_season?: number | null
        }
        Relationships: []
      }
      backup_3048_20260727_sprints: {
        Row: {
          backed_up_at: string | null
          profile_id: string | null
          race_id: string | null
          sprints_before: Json | null
          stage_number: number | null
        }
        Insert: {
          backed_up_at?: string | null
          profile_id?: string | null
          race_id?: string | null
          sprints_before?: Json | null
          stage_number?: number | null
        }
        Update: {
          backed_up_at?: string | null
          profile_id?: string | null
          race_id?: string | null
          sprints_before?: Json | null
          stage_number?: number | null
        }
        Relationships: []
      }
      backup_4155_entries_removed: {
        Row: {
          binding_span: unknown
          created_at: string | null
          is_auto_filled: boolean | null
          race_id: string | null
          race_role: string | null
          removal_reason: string | null
          removed_at: string | null
          rider_id: string | null
          team_id: string | null
        }
        Insert: {
          binding_span?: unknown
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Update: {
          binding_span?: unknown
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_4155_stage_schedule: {
        Row: {
          created_at: string | null
          game_day: number | null
          race_id: string | null
          scheduled_at: string | null
          stage_number: number | null
        }
        Insert: {
          created_at?: string | null
          game_day?: number | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
        }
        Update: {
          created_at?: string | null
          game_day?: number | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
        }
        Relationships: []
      }
      backup_4203_old_schedule: {
        Row: {
          game_day: number | null
          gemt_at: string | null
          race_id: string | null
          scheduled_at: string | null
          stage_number: number | null
        }
        Insert: {
          game_day?: number | null
          gemt_at?: string | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
        }
        Update: {
          game_day?: number | null
          gemt_at?: string | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
        }
        Relationships: []
      }
      backup_4203_removed_entries: {
        Row: {
          fase: number | null
          fjernet_at: string
          is_auto_filled: boolean | null
          konflikt_med: string | null
          maal_gd: number | null
          race_id: string | null
          race_role: string | null
          rider_id: string | null
          team_id: string | null
        }
        Insert: {
          fase?: number | null
          fjernet_at?: string
          is_auto_filled?: boolean | null
          konflikt_med?: string | null
          maal_gd?: number | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Update: {
          fase?: number | null
          fjernet_at?: string
          is_auto_filled?: boolean | null
          konflikt_med?: string | null
          maal_gd?: number | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_4203_rolled_back_at: {
        Row: {
          raekker_gendannet: number | null
          rullet_at: string
          sweep_raekker_fjernet: number | null
        }
        Insert: {
          raekker_gendannet?: number | null
          rullet_at?: string
          sweep_raekker_fjernet?: number | null
        }
        Update: {
          raekker_gendannet?: number | null
          rullet_at?: string
          sweep_raekker_fjernet?: number | null
        }
        Relationships: []
      }
      backup_4215_entries: {
        Row: {
          backed_up_at: string | null
          binding_span: unknown
          created_at: string | null
          is_auto_filled: boolean | null
          race_id: string | null
          race_role: string | null
          rider_id: string | null
          team_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          binding_span?: unknown
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          binding_span?: unknown
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_4215_races: {
        Row: {
          backed_up_at: string | null
          created_at: string | null
          edition_year: number | null
          game_day_start: number | null
          id: string | null
          league_division_id: number | null
          name: string | null
          pool_race_id: string | null
          prize_paid_at: string | null
          race_class: string | null
          race_type: string | null
          scheduled_for: string | null
          season_id: string | null
          stages: number | null
          stages_completed: number | null
          status: string | null
        }
        Insert: {
          backed_up_at?: string | null
          created_at?: string | null
          edition_year?: number | null
          game_day_start?: number | null
          id?: string | null
          league_division_id?: number | null
          name?: string | null
          pool_race_id?: string | null
          prize_paid_at?: string | null
          race_class?: string | null
          race_type?: string | null
          scheduled_for?: string | null
          season_id?: string | null
          stages?: number | null
          stages_completed?: number | null
          status?: string | null
        }
        Update: {
          backed_up_at?: string | null
          created_at?: string | null
          edition_year?: number | null
          game_day_start?: number | null
          id?: string | null
          league_division_id?: number | null
          name?: string | null
          pool_race_id?: string | null
          prize_paid_at?: string | null
          race_class?: string | null
          race_type?: string | null
          scheduled_for?: string | null
          season_id?: string | null
          stages?: number | null
          stages_completed?: number | null
          status?: string | null
        }
        Relationships: []
      }
      backup_4215_schedule: {
        Row: {
          backed_up_at: string | null
          created_at: string | null
          game_day: number | null
          race_id: string | null
          scheduled_at: string | null
          stage_number: number | null
        }
        Insert: {
          backed_up_at?: string | null
          created_at?: string | null
          game_day?: number | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
        }
        Update: {
          backed_up_at?: string | null
          created_at?: string | null
          game_day?: number | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
        }
        Relationships: []
      }
      backup_4218_entry_clears: {
        Row: {
          backed_up_at: string | null
          cleared_at: string | null
          race_id: string | null
          team_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          cleared_at?: string | null
          race_id?: string | null
          team_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          cleared_at?: string | null
          race_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_4218_peak_plans: {
        Row: {
          backed_up_at: string | null
          created_at: string | null
          id: string | null
          locked_at: string | null
          rider_id: string | null
          season_id: string | null
          target_race_id: string | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          backed_up_at?: string | null
          created_at?: string | null
          id?: string | null
          locked_at?: string | null
          rider_id?: string | null
          season_id?: string | null
          target_race_id?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          backed_up_at?: string | null
          created_at?: string | null
          id?: string | null
          locked_at?: string | null
          rider_id?: string | null
          season_id?: string | null
          target_race_id?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      backup_4218_stage_roles: {
        Row: {
          backed_up_at: string | null
          effort: string | null
          race_id: string | null
          race_role: string | null
          rider_id: string | null
          stage_number: number | null
          updated_at: string | null
        }
        Insert: {
          backed_up_at?: string | null
          effort?: string | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          stage_number?: number | null
          updated_at?: string | null
        }
        Update: {
          backed_up_at?: string | null
          effort?: string | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          stage_number?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_4218_withdrawals: {
        Row: {
          backed_up_at: string | null
          race_id: string | null
          team_id: string | null
          withdrawn_at: string | null
          withdrawn_reason: string | null
        }
        Insert: {
          backed_up_at?: string | null
          race_id?: string | null
          team_id?: string | null
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Update: {
          backed_up_at?: string | null
          race_id?: string | null
          team_id?: string | null
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Relationships: []
      }
      backup_4227_seasons_2026_08_25: {
        Row: {
          backed_up_at: string | null
          end_date: string | null
          id: string | null
          number: number | null
          start_date: string | null
          status: string | null
        }
        Insert: {
          backed_up_at?: string | null
          end_date?: string | null
          id?: string | null
          number?: number | null
          start_date?: string | null
          status?: string | null
        }
        Update: {
          backed_up_at?: string | null
          end_date?: string | null
          id?: string | null
          number?: number | null
          start_date?: string | null
          status?: string | null
        }
        Relationships: []
      }
      backup_4236_race_entries: {
        Row: {
          binding_span: unknown
          created_at: string | null
          is_auto_filled: boolean | null
          race_id: string | null
          race_role: string | null
          rider_id: string | null
          team_id: string | null
        }
        Insert: {
          binding_span?: unknown
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Update: {
          binding_span?: unknown
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_4236_race_entry_clears: {
        Row: {
          cleared_at: string | null
          race_id: string | null
          team_id: string | null
        }
        Insert: {
          cleared_at?: string | null
          race_id?: string | null
          team_id?: string | null
        }
        Update: {
          cleared_at?: string | null
          race_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_4236_race_stage_roles: {
        Row: {
          effort: string | null
          race_id: string | null
          race_role: string | null
          rider_id: string | null
          stage_number: number | null
          updated_at: string | null
        }
        Insert: {
          effort?: string | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          stage_number?: number | null
          updated_at?: string | null
        }
        Update: {
          effort?: string | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          stage_number?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_4236_race_withdrawals: {
        Row: {
          race_id: string | null
          team_id: string | null
          withdrawn_at: string | null
          withdrawn_reason: string | null
        }
        Insert: {
          race_id?: string | null
          team_id?: string | null
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Update: {
          race_id?: string | null
          team_id?: string | null
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Relationships: []
      }
      backup_4236_rider_peak_plans: {
        Row: {
          created_at: string | null
          id: string | null
          locked_at: string | null
          rider_id: string | null
          season_id: string | null
          target_race_id: string | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          locked_at?: string | null
          rider_id?: string | null
          season_id?: string | null
          target_race_id?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          locked_at?: string | null
          rider_id?: string | null
          season_id?: string | null
          target_race_id?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      backup_4294_rider_peak_plans: {
        Row: {
          backed_up_at: string | null
          created_at: string | null
          id: string | null
          locked_at: string | null
          rider_id: string | null
          season_id: string | null
          target_race_id: string | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          backed_up_at?: string | null
          created_at?: string | null
          id?: string | null
          locked_at?: string | null
          rider_id?: string | null
          season_id?: string | null
          target_race_id?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          backed_up_at?: string | null
          created_at?: string | null
          id?: string | null
          locked_at?: string | null
          rider_id?: string | null
          season_id?: string | null
          target_race_id?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      backup_academy_freeagent_fix_20260628: {
        Row: {
          acquired_at: string | null
          ai_team_id: string | null
          base_value: number | null
          birthdate: string | null
          contract_end_season: number | null
          contract_length: number | null
          created_at: string | null
          firstname: string | null
          height: number | null
          id: string | null
          is_academy: boolean | null
          is_retired: boolean | null
          is_u25: boolean | null
          lastname: string | null
          market_value: number | null
          nationality_code: string | null
          pcm_id: number | null
          pending_team_id: string | null
          popularity: number | null
          potentiale: number | null
          primary_type: string | null
          prize_earnings_bonus: number | null
          salary: number | null
          secondary_type: string | null
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
          acquired_at?: string | null
          ai_team_id?: string | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          firstname?: string | null
          height?: number | null
          id?: string | null
          is_academy?: boolean | null
          is_retired?: boolean | null
          is_u25?: boolean | null
          lastname?: string | null
          market_value?: number | null
          nationality_code?: string | null
          pcm_id?: number | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number | null
          salary?: number | null
          secondary_type?: string | null
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
          acquired_at?: string | null
          ai_team_id?: string | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          firstname?: string | null
          height?: number | null
          id?: string | null
          is_academy?: boolean | null
          is_retired?: boolean | null
          is_u25?: boolean | null
          lastname?: string | null
          market_value?: number | null
          nationality_code?: string | null
          pcm_id?: number | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number | null
          salary?: number | null
          secondary_type?: string | null
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
        Relationships: []
      }
      backup_academy_graduation_promote_contract_fix_20260805: {
        Row: {
          backed_up_at: string | null
          contract_end_season: number | null
          contract_length: number | null
          rider_id: string
          salary: number | null
          team_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          rider_id: string
          salary?: number | null
          team_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          rider_id?: string
          salary?: number | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_academy_promotion_contract_fix_20260725: {
        Row: {
          backed_up_at: string | null
          contract_end_season: number | null
          contract_length: number | null
          rider_id: string
          salary: number | null
          team_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          rider_id: string
          salary?: number | null
          team_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          rider_id?: string
          salary?: number | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_academy_salary_2083_20260703: {
        Row: {
          backed_up_at: string | null
          base_value: number | null
          id: string | null
          old_salary: number | null
          prize_earnings_bonus: number | null
        }
        Insert: {
          backed_up_at?: string | null
          base_value?: number | null
          id?: string | null
          old_salary?: number | null
          prize_earnings_bonus?: number | null
        }
        Update: {
          backed_up_at?: string | null
          base_value?: number | null
          id?: string | null
          old_salary?: number | null
          prize_earnings_bonus?: number | null
        }
        Relationships: []
      }
      backup_auction_push_24h_20260719: {
        Row: {
          backed_up_at: string | null
          id: string | null
          old_calculated_end: string | null
          status: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          old_calculated_end?: string | null
          status?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          old_calculated_end?: string | null
          status?: string | null
        }
        Relationships: []
      }
      backup_board_profiles_3514_20260823: {
        Row: {
          budget_modifier: number | null
          created_at: string | null
          cumulative_gc_wins: number | null
          cumulative_stage_wins: number | null
          current_goals: Json | null
          focus: string | null
          id: string | null
          is_baseline: boolean | null
          major_pivot_used_at: string | null
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
          season_start_anchor_season_id: string | null
          season_start_satisfaction: number | null
          seasons_completed: number | null
          team_id: string | null
          tradeoff_active_until_season_id: string | null
          tradeoff_payload: Json | null
          updated_at: string | null
        }
        Insert: {
          budget_modifier?: number | null
          created_at?: string | null
          cumulative_gc_wins?: number | null
          cumulative_stage_wins?: number | null
          current_goals?: Json | null
          focus?: string | null
          id?: string | null
          is_baseline?: boolean | null
          major_pivot_used_at?: string | null
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
          season_start_anchor_season_id?: string | null
          season_start_satisfaction?: number | null
          seasons_completed?: number | null
          team_id?: string | null
          tradeoff_active_until_season_id?: string | null
          tradeoff_payload?: Json | null
          updated_at?: string | null
        }
        Update: {
          budget_modifier?: number | null
          created_at?: string | null
          cumulative_gc_wins?: number | null
          cumulative_stage_wins?: number | null
          current_goals?: Json | null
          focus?: string | null
          id?: string | null
          is_baseline?: boolean | null
          major_pivot_used_at?: string | null
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
          season_start_anchor_season_id?: string | null
          season_start_satisfaction?: number | null
          seasons_completed?: number | null
          team_id?: string | null
          tradeoff_active_until_season_id?: string | null
          tradeoff_payload?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_boardgoals_formation_20260630: {
        Row: {
          backed_up_at: string | null
          board_id: string | null
          division: number | null
          focus: string | null
          negotiation_status: string | null
          old_goals: Json | null
          plan_type: string | null
          team_id: string | null
          team_name: string | null
        }
        Insert: {
          backed_up_at?: string | null
          board_id?: string | null
          division?: number | null
          focus?: string | null
          negotiation_status?: string | null
          old_goals?: Json | null
          plan_type?: string | null
          team_id?: string | null
          team_name?: string | null
        }
        Update: {
          backed_up_at?: string | null
          board_id?: string | null
          division?: number | null
          focus?: string | null
          negotiation_status?: string | null
          old_goals?: Json | null
          plan_type?: string | null
          team_id?: string | null
          team_name?: string | null
        }
        Relationships: []
      }
      backup_chronrebuild_20260628_entries: {
        Row: {
          created_at: string | null
          is_auto_filled: boolean | null
          race_id: string | null
          race_role: string | null
          rider_id: string | null
          team_id: string | null
        }
        Insert: {
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Update: {
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_chronrebuild_20260628_profiles: {
        Row: {
          demand_vector: Json | null
          finale_type: string | null
          generated_at: string | null
          generator_version: number | null
          id: string | null
          is_manual: boolean | null
          profile_type: string | null
          race_id: string | null
          stage_number: number | null
        }
        Insert: {
          demand_vector?: Json | null
          finale_type?: string | null
          generated_at?: string | null
          generator_version?: number | null
          id?: string | null
          is_manual?: boolean | null
          profile_type?: string | null
          race_id?: string | null
          stage_number?: number | null
        }
        Update: {
          demand_vector?: Json | null
          finale_type?: string | null
          generated_at?: string | null
          generator_version?: number | null
          id?: string | null
          is_manual?: boolean | null
          profile_type?: string | null
          race_id?: string | null
          stage_number?: number | null
        }
        Relationships: []
      }
      backup_chronrebuild_20260628_races: {
        Row: {
          created_at: string | null
          edition_year: number | null
          game_day_start: number | null
          id: string | null
          league_division_id: number | null
          name: string | null
          pool_race_id: string | null
          prize_paid_at: string | null
          race_class: string | null
          race_type: string | null
          scheduled_for: string | null
          season_id: string | null
          stages: number | null
          stages_completed: number | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          edition_year?: number | null
          game_day_start?: number | null
          id?: string | null
          league_division_id?: number | null
          name?: string | null
          pool_race_id?: string | null
          prize_paid_at?: string | null
          race_class?: string | null
          race_type?: string | null
          scheduled_for?: string | null
          season_id?: string | null
          stages?: number | null
          stages_completed?: number | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          edition_year?: number | null
          game_day_start?: number | null
          id?: string | null
          league_division_id?: number | null
          name?: string | null
          pool_race_id?: string | null
          prize_paid_at?: string | null
          race_class?: string | null
          race_type?: string | null
          scheduled_for?: string | null
          season_id?: string | null
          stages?: number | null
          stages_completed?: number | null
          status?: string | null
        }
        Relationships: []
      }
      backup_chronrebuild_20260628_schedule: {
        Row: {
          created_at: string | null
          game_day: number | null
          race_id: string | null
          scheduled_at: string | null
          stage_number: number | null
        }
        Insert: {
          created_at?: string | null
          game_day?: number | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
        }
        Update: {
          created_at?: string | null
          game_day?: number | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
        }
        Relationships: []
      }
      backup_chronrebuild_20260628_withdrawals: {
        Row: {
          race_id: string | null
          team_id: string | null
          withdrawn_at: string | null
          withdrawn_reason: string | null
        }
        Insert: {
          race_id?: string | null
          team_id?: string | null
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Update: {
          race_id?: string | null
          team_id?: string | null
          withdrawn_at?: string | null
          withdrawn_reason?: string | null
        }
        Relationships: []
      }
      backup_fairplay_20260722_orphan_entries: {
        Row: {
          created_at: string | null
          is_auto_filled: boolean | null
          race_id: string | null
          race_role: string | null
          rider_id: string | null
          team_id: string | null
        }
        Insert: {
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Update: {
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_fairplay_20260722_race_entries: {
        Row: {
          created_at: string | null
          is_auto_filled: boolean | null
          race_id: string | null
          race_role: string | null
          rider_id: string | null
          team_id: string | null
        }
        Insert: {
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Update: {
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_fairplay_20260722_riders: {
        Row: {
          acquired_at: string | null
          ai_team_id: string | null
          base_value: number | null
          birthdate: string | null
          contract_end_season: number | null
          contract_length: number | null
          created_at: string | null
          current_production_value: number | null
          firstname: string | null
          generation_tag: string | null
          height: number | null
          id: string | null
          is_academy: boolean | null
          is_retired: boolean | null
          is_u25: boolean | null
          lastname: string | null
          market_value: number | null
          nationality_code: string | null
          owner_is_ai: boolean | null
          pcm_id: number | null
          peak_suggestions_dismissed_season_id: string | null
          pending_team_id: string | null
          popularity: number | null
          potentiale: number | null
          primary_type: string | null
          prize_earnings_bonus: number | null
          salary: number | null
          secondary_type: string | null
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
          acquired_at?: string | null
          ai_team_id?: string | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          current_production_value?: number | null
          firstname?: string | null
          generation_tag?: string | null
          height?: number | null
          id?: string | null
          is_academy?: boolean | null
          is_retired?: boolean | null
          is_u25?: boolean | null
          lastname?: string | null
          market_value?: number | null
          nationality_code?: string | null
          owner_is_ai?: boolean | null
          pcm_id?: number | null
          peak_suggestions_dismissed_season_id?: string | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number | null
          salary?: number | null
          secondary_type?: string | null
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
          acquired_at?: string | null
          ai_team_id?: string | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          current_production_value?: number | null
          firstname?: string | null
          generation_tag?: string | null
          height?: number | null
          id?: string | null
          is_academy?: boolean | null
          is_retired?: boolean | null
          is_u25?: boolean | null
          lastname?: string | null
          market_value?: number | null
          nationality_code?: string | null
          owner_is_ai?: boolean | null
          pcm_id?: number | null
          peak_suggestions_dismissed_season_id?: string | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number | null
          salary?: number | null
          secondary_type?: string | null
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
        Relationships: []
      }
      backup_fairplay_20260722_teams: {
        Row: {
          academy_intake_seeded_at: string | null
          ai_source_id: number | null
          balance: number | null
          consecutive_low_satisfaction_expirations: number | null
          created_at: string | null
          debt_breach_streak: number | null
          division: number | null
          emergency_loan_streak: number | null
          id: string | null
          is_ai: boolean | null
          is_bank: boolean | null
          is_frozen: boolean | null
          is_test_account: boolean | null
          league_division_id: number | null
          manager_name: string | null
          my_result_seen_race_id: string | null
          name: string | null
          onboarding_progress_dismissed_at: string | null
          pending_removal_at: string | null
          season_1_identity_basis: Json | null
          sponsor_income: number | null
          starter_depth_topped_up_at: string | null
          starter_squad_allocated_at: string | null
          team_dna_chosen_at: string | null
          team_dna_key: string | null
          transfer_frozen: boolean | null
          user_id: string | null
        }
        Insert: {
          academy_intake_seeded_at?: string | null
          ai_source_id?: number | null
          balance?: number | null
          consecutive_low_satisfaction_expirations?: number | null
          created_at?: string | null
          debt_breach_streak?: number | null
          division?: number | null
          emergency_loan_streak?: number | null
          id?: string | null
          is_ai?: boolean | null
          is_bank?: boolean | null
          is_frozen?: boolean | null
          is_test_account?: boolean | null
          league_division_id?: number | null
          manager_name?: string | null
          my_result_seen_race_id?: string | null
          name?: string | null
          onboarding_progress_dismissed_at?: string | null
          pending_removal_at?: string | null
          season_1_identity_basis?: Json | null
          sponsor_income?: number | null
          starter_depth_topped_up_at?: string | null
          starter_squad_allocated_at?: string | null
          team_dna_chosen_at?: string | null
          team_dna_key?: string | null
          transfer_frozen?: boolean | null
          user_id?: string | null
        }
        Update: {
          academy_intake_seeded_at?: string | null
          ai_source_id?: number | null
          balance?: number | null
          consecutive_low_satisfaction_expirations?: number | null
          created_at?: string | null
          debt_breach_streak?: number | null
          division?: number | null
          emergency_loan_streak?: number | null
          id?: string | null
          is_ai?: boolean | null
          is_bank?: boolean | null
          is_frozen?: boolean | null
          is_test_account?: boolean | null
          league_division_id?: number | null
          manager_name?: string | null
          my_result_seen_race_id?: string | null
          name?: string | null
          onboarding_progress_dismissed_at?: string | null
          pending_removal_at?: string | null
          season_1_identity_basis?: Json | null
          sponsor_income?: number | null
          starter_depth_topped_up_at?: string | null
          starter_squad_allocated_at?: string | null
          team_dna_chosen_at?: string | null
          team_dna_key?: string | null
          transfer_frozen?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      backup_fairplay_20260722_transfer_offers: {
        Row: {
          buyer_archived_at: string | null
          buyer_confirmed: boolean | null
          buyer_team_id: string | null
          counter_amount: number | null
          created_at: string | null
          expires_at: string | null
          id: string | null
          last_action_by: string | null
          listing_id: string | null
          message: string | null
          offer_amount: number | null
          rider_id: string | null
          round: number | null
          seller_archived_at: string | null
          seller_confirmed: boolean | null
          seller_team_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          buyer_archived_at?: string | null
          buyer_confirmed?: boolean | null
          buyer_team_id?: string | null
          counter_amount?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          last_action_by?: string | null
          listing_id?: string | null
          message?: string | null
          offer_amount?: number | null
          rider_id?: string | null
          round?: number | null
          seller_archived_at?: string | null
          seller_confirmed?: boolean | null
          seller_team_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          buyer_archived_at?: string | null
          buyer_confirmed?: boolean | null
          buyer_team_id?: string | null
          counter_amount?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          last_action_by?: string | null
          listing_id?: string | null
          message?: string | null
          offer_amount?: number | null
          rider_id?: string | null
          round?: number | null
          seller_archived_at?: string | null
          seller_confirmed?: boolean | null
          seller_team_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_fairplay_20260722_users: {
        Row: {
          created_at: string | null
          discord_id: string | null
          email: string | null
          id: string | null
          last_seen: string | null
          level: number | null
          role: string | null
          username: string | null
          xp: number | null
        }
        Insert: {
          created_at?: string | null
          discord_id?: string | null
          email?: string | null
          id?: string | null
          last_seen?: string | null
          level?: number | null
          role?: string | null
          username?: string | null
          xp?: number | null
        }
        Update: {
          created_at?: string | null
          discord_id?: string | null
          email?: string | null
          id?: string | null
          last_seen?: string | null
          level?: number | null
          role?: string | null
          username?: string | null
          xp?: number | null
        }
        Relationships: []
      }
      backup_fairplay_2221_20260706_listings: {
        Row: {
          asking_price: number | null
          created_at: string | null
          id: string | null
          rider_id: string | null
          seller_team_id: string | null
          status: string | null
        }
        Insert: {
          asking_price?: number | null
          created_at?: string | null
          id?: string | null
          rider_id?: string | null
          seller_team_id?: string | null
          status?: string | null
        }
        Update: {
          asking_price?: number | null
          created_at?: string | null
          id?: string | null
          rider_id?: string | null
          seller_team_id?: string | null
          status?: string | null
        }
        Relationships: []
      }
      backup_fairplay_2221_20260706_race_entries: {
        Row: {
          created_at: string | null
          is_auto_filled: boolean | null
          race_id: string | null
          race_role: string | null
          rider_id: string | null
          team_id: string | null
        }
        Insert: {
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Update: {
          created_at?: string | null
          is_auto_filled?: boolean | null
          race_id?: string | null
          race_role?: string | null
          rider_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_fairplay_2221_20260706_riders: {
        Row: {
          acquired_at: string | null
          ai_team_id: string | null
          base_value: number | null
          birthdate: string | null
          contract_end_season: number | null
          contract_length: number | null
          created_at: string | null
          firstname: string | null
          height: number | null
          id: string | null
          is_academy: boolean | null
          is_retired: boolean | null
          is_u25: boolean | null
          lastname: string | null
          market_value: number | null
          nationality_code: string | null
          pcm_id: number | null
          pending_team_id: string | null
          popularity: number | null
          potentiale: number | null
          primary_type: string | null
          prize_earnings_bonus: number | null
          salary: number | null
          secondary_type: string | null
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
          acquired_at?: string | null
          ai_team_id?: string | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          firstname?: string | null
          height?: number | null
          id?: string | null
          is_academy?: boolean | null
          is_retired?: boolean | null
          is_u25?: boolean | null
          lastname?: string | null
          market_value?: number | null
          nationality_code?: string | null
          pcm_id?: number | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number | null
          salary?: number | null
          secondary_type?: string | null
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
          acquired_at?: string | null
          ai_team_id?: string | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          firstname?: string | null
          height?: number | null
          id?: string | null
          is_academy?: boolean | null
          is_retired?: boolean | null
          is_u25?: boolean | null
          lastname?: string | null
          market_value?: number | null
          nationality_code?: string | null
          pcm_id?: number | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number | null
          salary?: number | null
          secondary_type?: string | null
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
        Relationships: []
      }
      backup_fairplay_2221_20260706_sponsors: {
        Row: {
          created_at: string | null
          expires_after_season: number | null
          guaranteed_base: number | null
          id: string | null
          length_seasons: number | null
          per_race_day_rate: number | null
          sponsor_name: string | null
          start_season: number | null
          status: string | null
          team_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_after_season?: number | null
          guaranteed_base?: number | null
          id?: string | null
          length_seasons?: number | null
          per_race_day_rate?: number | null
          sponsor_name?: string | null
          start_season?: number | null
          status?: string | null
          team_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_after_season?: number | null
          guaranteed_base?: number | null
          id?: string | null
          length_seasons?: number | null
          per_race_day_rate?: number | null
          sponsor_name?: string | null
          start_season?: number | null
          status?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_fairplay_2221_20260706_standings: {
        Row: {
          division: number | null
          gc_wins: number | null
          id: string | null
          league_division_id: number | null
          penalty_points: number | null
          races_completed: number | null
          rank_in_division: number | null
          season_id: string | null
          stage_wins: number | null
          team_id: string | null
          total_points: number | null
          updated_at: string | null
        }
        Insert: {
          division?: number | null
          gc_wins?: number | null
          id?: string | null
          league_division_id?: number | null
          penalty_points?: number | null
          races_completed?: number | null
          rank_in_division?: number | null
          season_id?: string | null
          stage_wins?: number | null
          team_id?: string | null
          total_points?: number | null
          updated_at?: string | null
        }
        Update: {
          division?: number | null
          gc_wins?: number | null
          id?: string | null
          league_division_id?: number | null
          penalty_points?: number | null
          races_completed?: number | null
          rank_in_division?: number | null
          season_id?: string | null
          stage_wins?: number | null
          team_id?: string | null
          total_points?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_fairplay_2221_20260706_strategy: {
        Row: {
          a_chain: Json | null
          captain_priorities: Json | null
          target_race_ids: Json | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          a_chain?: Json | null
          captain_priorities?: Json | null
          target_race_ids?: Json | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          a_chain?: Json | null
          captain_priorities?: Json | null
          target_race_ids?: Json | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_fairplay_2221_20260706_teams: {
        Row: {
          academy_intake_seeded_at: string | null
          ai_source_id: number | null
          balance: number | null
          consecutive_low_satisfaction_expirations: number | null
          created_at: string | null
          debt_breach_streak: number | null
          division: number | null
          id: string | null
          is_ai: boolean | null
          is_bank: boolean | null
          is_frozen: boolean | null
          is_test_account: boolean | null
          league_division_id: number | null
          manager_name: string | null
          name: string | null
          season_1_identity_basis: Json | null
          sponsor_income: number | null
          starter_depth_topped_up_at: string | null
          starter_squad_allocated_at: string | null
          team_dna_chosen_at: string | null
          team_dna_key: string | null
          transfer_frozen: boolean | null
          user_id: string | null
        }
        Insert: {
          academy_intake_seeded_at?: string | null
          ai_source_id?: number | null
          balance?: number | null
          consecutive_low_satisfaction_expirations?: number | null
          created_at?: string | null
          debt_breach_streak?: number | null
          division?: number | null
          id?: string | null
          is_ai?: boolean | null
          is_bank?: boolean | null
          is_frozen?: boolean | null
          is_test_account?: boolean | null
          league_division_id?: number | null
          manager_name?: string | null
          name?: string | null
          season_1_identity_basis?: Json | null
          sponsor_income?: number | null
          starter_depth_topped_up_at?: string | null
          starter_squad_allocated_at?: string | null
          team_dna_chosen_at?: string | null
          team_dna_key?: string | null
          transfer_frozen?: boolean | null
          user_id?: string | null
        }
        Update: {
          academy_intake_seeded_at?: string | null
          ai_source_id?: number | null
          balance?: number | null
          consecutive_low_satisfaction_expirations?: number | null
          created_at?: string | null
          debt_breach_streak?: number | null
          division?: number | null
          id?: string | null
          is_ai?: boolean | null
          is_bank?: boolean | null
          is_frozen?: boolean | null
          is_test_account?: boolean | null
          league_division_id?: number | null
          manager_name?: string | null
          name?: string | null
          season_1_identity_basis?: Json | null
          sponsor_income?: number | null
          starter_depth_topped_up_at?: string | null
          starter_squad_allocated_at?: string | null
          team_dna_chosen_at?: string | null
          team_dna_key?: string | null
          transfer_frozen?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      backup_gate_log_3449_20260823: {
        Row: {
          c_candidate: number | null
          completed_at: string | null
          created_at: string | null
          gate_reason: string | null
          gate_reason_text: string | null
          gate_status: string | null
          id: string | null
          measured_date: string | null
          median_price_over_anchor_90d: number | null
          min_qualified_trades: number | null
          n_qualified_90d: number | null
          rolling_medians: Json | null
          stability_band: number | null
        }
        Insert: {
          c_candidate?: number | null
          completed_at?: string | null
          created_at?: string | null
          gate_reason?: string | null
          gate_reason_text?: string | null
          gate_status?: string | null
          id?: string | null
          measured_date?: string | null
          median_price_over_anchor_90d?: number | null
          min_qualified_trades?: number | null
          n_qualified_90d?: number | null
          rolling_medians?: Json | null
          stability_band?: number | null
        }
        Update: {
          c_candidate?: number | null
          completed_at?: string | null
          created_at?: string | null
          gate_reason?: string | null
          gate_reason_text?: string | null
          gate_status?: string | null
          id?: string | null
          measured_date?: string | null
          median_price_over_anchor_90d?: number | null
          min_qualified_trades?: number | null
          n_qualified_90d?: number | null
          rolling_medians?: Json | null
          stability_band?: number | null
        }
        Relationships: []
      }
      backup_ghost_auctions_fix_20260628: {
        Row: {
          actual_end: string | null
          calculated_end: string | null
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          created_at: string | null
          current_bidder_id: string | null
          current_price: number | null
          extension_count: number | null
          guaranteed_price: number | null
          id: string | null
          is_flash: boolean | null
          is_guaranteed_sale: boolean | null
          is_youth: boolean | null
          min_increment: number | null
          requested_start: string | null
          rider_id: string | null
          seller_team_id: string | null
          starting_price: number | null
          status: string | null
        }
        Insert: {
          actual_end?: string | null
          calculated_end?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string | null
          current_bidder_id?: string | null
          current_price?: number | null
          extension_count?: number | null
          guaranteed_price?: number | null
          id?: string | null
          is_flash?: boolean | null
          is_guaranteed_sale?: boolean | null
          is_youth?: boolean | null
          min_increment?: number | null
          requested_start?: string | null
          rider_id?: string | null
          seller_team_id?: string | null
          starting_price?: number | null
          status?: string | null
        }
        Update: {
          actual_end?: string | null
          calculated_end?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string | null
          current_bidder_id?: string | null
          current_price?: number | null
          extension_count?: number | null
          guaranteed_price?: number | null
          id?: string | null
          is_flash?: boolean | null
          is_guaranteed_sale?: boolean | null
          is_youth?: boolean | null
          min_increment?: number | null
          requested_start?: string | null
          rider_id?: string | null
          seller_team_id?: string | null
          starting_price?: number | null
          status?: string | null
        }
        Relationships: []
      }
      backup_italiensk_klassiker_monument_goal_fix_20260731: {
        Row: {
          backed_up_at: string | null
          board_id: string
          current_goals: Json | null
          team_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          board_id: string
          current_goals?: Json | null
          team_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          board_id?: string
          current_goals?: Json | null
          team_id?: string | null
        }
        Relationships: []
      }
      backup_race_results_2103_20260702: {
        Row: {
          breakaway_caught: boolean | null
          finish_time: string | null
          id: string | null
          imported_at: string | null
          in_breakaway: boolean | null
          points_earned: number | null
          prize_money: number | null
          race_id: string | null
          rank: number | null
          result_type: string | null
          rider_id: string | null
          rider_name: string | null
          stage_number: number | null
          team_id: string | null
          team_name: string | null
        }
        Insert: {
          breakaway_caught?: boolean | null
          finish_time?: string | null
          id?: string | null
          imported_at?: string | null
          in_breakaway?: boolean | null
          points_earned?: number | null
          prize_money?: number | null
          race_id?: string | null
          rank?: number | null
          result_type?: string | null
          rider_id?: string | null
          rider_name?: string | null
          stage_number?: number | null
          team_id?: string | null
          team_name?: string | null
        }
        Update: {
          breakaway_caught?: boolean | null
          finish_time?: string | null
          id?: string | null
          imported_at?: string | null
          in_breakaway?: boolean | null
          points_earned?: number | null
          prize_money?: number | null
          race_id?: string | null
          rank?: number | null
          result_type?: string | null
          rider_id?: string | null
          rider_name?: string | null
          stage_number?: number | null
          team_id?: string | null
          team_name?: string | null
        }
        Relationships: []
      }
      backup_races_4131b_20260823: {
        Row: {
          game_day_start: number | null
          id: string | null
          scheduled_for: string | null
          taken_at: string | null
        }
        Insert: {
          game_day_start?: number | null
          id?: string | null
          scheduled_for?: string | null
          taken_at?: string | null
        }
        Update: {
          game_day_start?: number | null
          id?: string | null
          scheduled_for?: string | null
          taken_at?: string | null
        }
        Relationships: []
      }
      backup_rsp_4106_20260823: {
        Row: {
          finale_type: string | null
          id: string | null
          race_id: string | null
          taken_at: string | null
        }
        Insert: {
          finale_type?: string | null
          id?: string | null
          race_id?: string | null
          taken_at?: string | null
        }
        Update: {
          finale_type?: string | null
          id?: string | null
          race_id?: string | null
          taken_at?: string | null
        }
        Relationships: []
      }
      backup_rss_4131b_20260823: {
        Row: {
          game_day: number | null
          race_id: string | null
          scheduled_at: string | null
          stage_number: number | null
          taken_at: string | null
        }
        Insert: {
          game_day?: number | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
          taken_at?: string | null
        }
        Update: {
          game_day?: number | null
          race_id?: string | null
          scheduled_at?: string | null
          stage_number?: number | null
          taken_at?: string | null
        }
        Relationships: []
      }
      backup_seedfix_20260628_race_stage_profiles: {
        Row: {
          demand_vector: Json | null
          finale_type: string | null
          generated_at: string | null
          generator_version: number | null
          id: string | null
          is_manual: boolean | null
          profile_type: string | null
          race_id: string | null
          stage_number: number | null
        }
        Insert: {
          demand_vector?: Json | null
          finale_type?: string | null
          generated_at?: string | null
          generator_version?: number | null
          id?: string | null
          is_manual?: boolean | null
          profile_type?: string | null
          race_id?: string | null
          stage_number?: number | null
        }
        Update: {
          demand_vector?: Json | null
          finale_type?: string | null
          generated_at?: string | null
          generator_version?: number | null
          id?: string | null
          is_manual?: boolean | null
          profile_type?: string | null
          race_id?: string | null
          stage_number?: number | null
        }
        Relationships: []
      }
      backup_team_csc_board_2104_20260702: {
        Row: {
          budget_modifier: number | null
          created_at: string | null
          cumulative_gc_wins: number | null
          cumulative_stage_wins: number | null
          current_goals: Json | null
          focus: string | null
          id: string | null
          is_baseline: boolean | null
          major_pivot_used_at: string | null
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
          season_start_anchor_season_id: string | null
          season_start_satisfaction: number | null
          seasons_completed: number | null
          team_id: string | null
          tradeoff_active_until_season_id: string | null
          tradeoff_payload: Json | null
          updated_at: string | null
        }
        Insert: {
          budget_modifier?: number | null
          created_at?: string | null
          cumulative_gc_wins?: number | null
          cumulative_stage_wins?: number | null
          current_goals?: Json | null
          focus?: string | null
          id?: string | null
          is_baseline?: boolean | null
          major_pivot_used_at?: string | null
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
          season_start_anchor_season_id?: string | null
          season_start_satisfaction?: number | null
          seasons_completed?: number | null
          team_id?: string | null
          tradeoff_active_until_season_id?: string | null
          tradeoff_payload?: Json | null
          updated_at?: string | null
        }
        Update: {
          budget_modifier?: number | null
          created_at?: string | null
          cumulative_gc_wins?: number | null
          cumulative_stage_wins?: number | null
          current_goals?: Json | null
          focus?: string | null
          id?: string | null
          is_baseline?: boolean | null
          major_pivot_used_at?: string | null
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
          season_start_anchor_season_id?: string | null
          season_start_satisfaction?: number | null
          seasons_completed?: number | null
          team_id?: string | null
          tradeoff_active_until_season_id?: string | null
          tradeoff_payload?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      board_consequences: {
        Row: {
          created_at: string
          expires_at_season_id: string | null
          id: string
          layer: number
          payload: Json
          resolved_at: string | null
          severity: number
          source_board_id: string | null
          status: string
          team_id: string
        }
        Insert: {
          created_at?: string
          expires_at_season_id?: string | null
          id?: string
          layer: number
          payload?: Json
          resolved_at?: string | null
          severity: number
          source_board_id?: string | null
          status?: string
          team_id: string
        }
        Update: {
          created_at?: string
          expires_at_season_id?: string | null
          id?: string
          layer?: number
          payload?: Json
          resolved_at?: string | null
          severity?: number
          source_board_id?: string | null
          status?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_consequences_expires_at_season_id_fkey"
            columns: ["expires_at_season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "board_consequences_expires_at_season_id_fkey"
            columns: ["expires_at_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_consequences_source_board_id_fkey"
            columns: ["source_board_id"]
            isOneToOne: false
            referencedRelation: "board_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_consequences_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "board_consequences_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      board_mandates: {
        Row: {
          adjustments_allowed: number
          adjustments_used: number
          auto_accept_deadline: string | null
          created_at: string
          extraordinary_request_unlocked: boolean
          extraordinary_request_used: boolean
          focus: string | null
          goals: Json
          id: string
          proposed_at: string | null
          request_used: boolean
          season_id: string | null
          season_number: number | null
          signed_at: string | null
          source: Json
          status: string
          team_id: string
          updated_at: string
        }
        Insert: {
          adjustments_allowed?: number
          adjustments_used?: number
          auto_accept_deadline?: string | null
          created_at?: string
          extraordinary_request_unlocked?: boolean
          extraordinary_request_used?: boolean
          focus?: string | null
          goals?: Json
          id?: string
          proposed_at?: string | null
          request_used?: boolean
          season_id?: string | null
          season_number?: number | null
          signed_at?: string | null
          source?: Json
          status?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          adjustments_allowed?: number
          adjustments_used?: number
          auto_accept_deadline?: string | null
          created_at?: string
          extraordinary_request_unlocked?: boolean
          extraordinary_request_used?: boolean
          focus?: string | null
          goals?: Json
          id?: string
          proposed_at?: string | null
          request_used?: boolean
          season_id?: string | null
          season_number?: number | null
          signed_at?: string | null
          source?: Json
          status?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_mandates_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "board_mandates_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_mandates_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "board_mandates_team_id_fkey"
            columns: ["team_id"]
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
          u25_count: number
          u25_stat_sum: number
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
          u25_count?: number
          u25_stat_sum?: number
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
          u25_count?: number
          u25_stat_sum?: number
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
          is_baseline: boolean
          major_pivot_used_at: string | null
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
          season_start_anchor_season_id: string | null
          season_start_satisfaction: number | null
          seasons_completed: number
          team_id: string
          tradeoff_active_until_season_id: string | null
          tradeoff_payload: Json | null
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
          is_baseline?: boolean
          major_pivot_used_at?: string | null
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
          season_start_anchor_season_id?: string | null
          season_start_satisfaction?: number | null
          seasons_completed?: number
          team_id: string
          tradeoff_active_until_season_id?: string | null
          tradeoff_payload?: Json | null
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
          is_baseline?: boolean
          major_pivot_used_at?: string | null
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
          season_start_anchor_season_id?: string | null
          season_start_satisfaction?: number | null
          seasons_completed?: number
          team_id?: string
          tradeoff_active_until_season_id?: string | null
          tradeoff_payload?: Json | null
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
            foreignKeyName: "board_profiles_season_start_anchor_season_id_fkey"
            columns: ["season_start_anchor_season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "board_profiles_season_start_anchor_season_id_fkey"
            columns: ["season_start_anchor_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "board_profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_profiles_tradeoff_active_until_season_id_fkey"
            columns: ["tradeoff_active_until_season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "board_profiles_tradeoff_active_until_season_id_fkey"
            columns: ["tradeoff_active_until_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      board_relations: {
        Row: {
          category_scores: Json
          confidence: number
          confidence_source: Json
          created_at: string
          id: string
          last_event_at: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          category_scores?: Json
          confidence?: number
          confidence_source?: Json
          created_at?: string
          id?: string
          last_event_at?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          category_scores?: Json
          confidence?: number
          confidence_source?: Json
          created_at?: string
          id?: string
          last_event_at?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_relations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "board_relations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      board_satisfaction_events: {
        Row: {
          board_id: string | null
          created_at: string
          goals_met: number
          goals_total: number
          id: string
          mandate_id: string | null
          milestone_id: string | null
          race_days_completed: number | null
          race_id: string | null
          race_name: string | null
          reason_category: string | null
          satisfaction_after: number
          satisfaction_before: number
          satisfaction_delta: number
          season_id: string
          team_id: string
        }
        Insert: {
          board_id?: string | null
          created_at?: string
          goals_met?: number
          goals_total?: number
          id?: string
          mandate_id?: string | null
          milestone_id?: string | null
          race_days_completed?: number | null
          race_id?: string | null
          race_name?: string | null
          reason_category?: string | null
          satisfaction_after: number
          satisfaction_before: number
          satisfaction_delta: number
          season_id: string
          team_id: string
        }
        Update: {
          board_id?: string | null
          created_at?: string
          goals_met?: number
          goals_total?: number
          id?: string
          mandate_id?: string | null
          milestone_id?: string | null
          race_days_completed?: number | null
          race_id?: string | null
          race_name?: string | null
          reason_category?: string | null
          satisfaction_after?: number
          satisfaction_before?: number
          satisfaction_delta?: number
          season_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_satisfaction_events_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "board_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_satisfaction_events_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "board_mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_satisfaction_events_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "board_vision_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_satisfaction_events_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_satisfaction_events_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "board_satisfaction_events_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_satisfaction_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "board_satisfaction_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      board_vision_milestones: {
        Row: {
          confidence_delta: number | null
          created_at: string
          evaluated_at: string | null
          goal: Json
          id: string
          is_headline: boolean
          milestone_key: string
          origin: string
          status: string
          target_season_number: number
          team_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          confidence_delta?: number | null
          created_at?: string
          evaluated_at?: string | null
          goal?: Json
          id?: string
          is_headline?: boolean
          milestone_key: string
          origin?: string
          status?: string
          target_season_number: number
          team_id: string
          updated_at?: string
          weight?: number
        }
        Update: {
          confidence_delta?: number | null
          created_at?: string
          evaluated_at?: string | null
          goal?: Json
          id?: string
          is_headline?: boolean
          milestone_key?: string
          origin?: string
          status?: string
          target_season_number?: number
          team_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "board_vision_milestones_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "board_vision_milestones_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          birth_weight: number
          continent: string | null
          created_at: string
          ioc_code: string | null
          is_active: boolean
          iso2: string
          name_da: string | null
          name_en: string
          reputation: number
          reputation_seed: number
          talent_ceiling: number
          updated_at: string
        }
        Insert: {
          birth_weight?: number
          continent?: string | null
          created_at?: string
          ioc_code?: string | null
          is_active?: boolean
          iso2: string
          name_da?: string | null
          name_en: string
          reputation?: number
          reputation_seed?: number
          talent_ceiling?: number
          updated_at?: string
        }
        Update: {
          birth_weight?: number
          continent?: string | null
          created_at?: string
          ioc_code?: string | null
          is_active?: boolean
          iso2?: string
          name_da?: string | null
          name_en?: string
          reputation?: number
          reputation_seed?: number
          talent_ceiling?: number
          updated_at?: string
        }
        Relationships: []
      }
      cutover_3645_backup_20260823: {
        Row: {
          captured_at: string
          row_before: Json
          row_id: string
          table_name: string
        }
        Insert: {
          captured_at?: string
          row_before: Json
          row_id: string
          table_name: string
        }
        Update: {
          captured_at?: string
          row_before?: Json
          row_id?: string
          table_name?: string
        }
        Relationships: []
      }
      discord_dm_outbox: {
        Row: {
          attempts: number
          created_at: string
          dead_at: string | null
          discord_id: string
          id: string
          last_error: string | null
          last_status: number | null
          next_attempt_at: string
          payload: Json
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dead_at?: string | null
          discord_id: string
          id?: string
          last_error?: string | null
          last_status?: number | null
          next_attempt_at: string
          payload: Json
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dead_at?: string | null
          discord_id?: string
          id?: string
          last_error?: string | null
          last_status?: number | null
          next_attempt_at?: string
          payload?: Json
          status?: string
        }
        Relationships: []
      }
      discord_race_digest_log: {
        Row: {
          created_at: string
          digest_date: string
          id: string
          item_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          digest_date: string
          id?: string
          item_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          digest_date?: string
          id?: string
          item_count?: number
          user_id?: string
        }
        Relationships: []
      }
      discord_settings: {
        Row: {
          created_at: string | null
          id: string
          is_default: boolean | null
          is_summary: boolean
          league_division_id: number | null
          tier: number | null
          webhook_name: string
          webhook_type: string
          webhook_url: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          is_summary?: boolean
          league_division_id?: number | null
          tier?: number | null
          webhook_name: string
          webhook_type?: string
          webhook_url: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          is_summary?: boolean
          league_division_id?: number | null
          tier?: number | null
          webhook_name?: string
          webhook_type?: string
          webhook_url?: string
        }
        Relationships: []
      }
      discord_webhook_outbox: {
        Row: {
          attempts: number
          created_at: string
          dead_at: string | null
          id: string
          last_error: string | null
          last_status: number | null
          next_attempt_at: string
          payload: Json
          status: string
          webhook_url: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dead_at?: string | null
          id?: string
          last_error?: string | null
          last_status?: number | null
          next_attempt_at: string
          payload: Json
          status?: string
          webhook_url: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dead_at?: string | null
          id?: string
          last_error?: string | null
          last_status?: number | null
          next_attempt_at?: string
          payload?: Json
          status?: string
          webhook_url?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string
          email_type: string
          error: string | null
          id: string
          next_attempt_at: string | null
          provider_id: string | null
          retry_payload: Json | null
          status: string
          team_id: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key: string
          email_type: string
          error?: string | null
          id?: string
          next_attempt_at?: string | null
          provider_id?: string | null
          retry_payload?: Json | null
          status: string
          team_id?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string
          email_type?: string
          error?: string | null
          id?: string
          next_attempt_at?: string | null
          provider_id?: string | null
          retry_payload?: Json | null
          status?: string
          team_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      fairplay_flags: {
        Row: {
          created_at: string
          evidence: Json
          first_detected_at: string
          flag_type: string
          id: string
          last_scored_at: string
          owner_note: string | null
          score: number
          signals: Json
          status: string
          team_id_hi: string
          team_id_lo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          evidence?: Json
          first_detected_at?: string
          flag_type: string
          id?: string
          last_scored_at?: string
          owner_note?: string | null
          score: number
          signals?: Json
          status?: string
          team_id_hi: string
          team_id_lo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          evidence?: Json
          first_detected_at?: string
          flag_type?: string
          id?: string
          last_scored_at?: string
          owner_note?: string | null
          score?: number
          signals?: Json
          status?: string
          team_id_hi?: string
          team_id_lo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fairplay_flags_team_id_hi_fkey"
            columns: ["team_id_hi"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "fairplay_flags_team_id_hi_fkey"
            columns: ["team_id_hi"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fairplay_flags_team_id_lo_fkey"
            columns: ["team_id_lo"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "fairplay_flags_team_id_lo_fkey"
            columns: ["team_id_lo"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      fairplay_whitelisted_pairs: {
        Row: {
          created_at: string
          id: string
          reason: string
          team_id_hi: string
          team_id_lo: string
          whitelisted_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          team_id_hi: string
          team_id_lo: string
          whitelisted_by?: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          team_id_hi?: string
          team_id_lo?: string
          whitelisted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "fairplay_whitelisted_pairs_team_id_hi_fkey"
            columns: ["team_id_hi"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "fairplay_whitelisted_pairs_team_id_hi_fkey"
            columns: ["team_id_hi"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fairplay_whitelisted_pairs_team_id_lo_fkey"
            columns: ["team_id_lo"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "fairplay_whitelisted_pairs_team_id_lo_fkey"
            columns: ["team_id_lo"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_transactions: {
        Row: {
          actor_id: string | null
          actor_type: string | null
          after_balance: number | null
          amount: number
          before_balance: number | null
          created_at: string | null
          description: string | null
          id: string
          idempotency_key: string | null
          metadata: Json | null
          race_id: string | null
          reason_code: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          related_loan_id: string | null
          season_id: string | null
          source_path: string | null
          team_id: string
          type: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string | null
          after_balance?: number | null
          amount: number
          before_balance?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          race_id?: string | null
          reason_code?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          related_loan_id?: string | null
          season_id?: string | null
          source_path?: string | null
          team_id: string
          type: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string | null
          after_balance?: number | null
          amount?: number
          before_balance?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          race_id?: string | null
          reason_code?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          related_loan_id?: string | null
          season_id?: string | null
          source_path?: string | null
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
            foreignKeyName: "finance_transactions_related_loan_id_fkey"
            columns: ["related_loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      forum_poll_options: {
        Row: {
          id: string
          idx: number
          label: string
          post_id: string
        }
        Insert: {
          id?: string
          idx: number
          label: string
          post_id: string
        }
        Update: {
          id?: string
          idx?: number
          label?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_poll_options_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_poll_votes: {
        Row: {
          created_at: string
          option_id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          option_id: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          option_id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "forum_poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_poll_votes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_posts: {
        Row: {
          body: string
          category: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_pinned: boolean
          last_reply_at: string | null
          reply_count: number
          seq: number
          team_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_pinned?: boolean
          last_reply_at?: string | null
          reply_count?: number
          seq?: number
          team_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_pinned?: boolean
          last_reply_at?: string | null
          reply_count?: number
          seq?: number
          team_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_posts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "forum_posts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_reactions: {
        Row: {
          created_at: string
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: []
      }
      forum_replies: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          post_id: string
          quoted_reply_id: string | null
          seq: number
          team_id: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          post_id: string
          quoted_reply_id?: string | null
          seq?: number
          team_id?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          post_id?: string
          quoted_reply_id?: string | null
          seq?: number
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_replies_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_replies_quoted_reply_id_fkey"
            columns: ["quoted_reply_id"]
            isOneToOne: false
            referencedRelation: "forum_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_replies_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "forum_replies_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_reports: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          reporter_user_id: string
          resolved_at: string | null
          resolved_by: string | null
          seq: number
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_user_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          seq?: number
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_user_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          seq?: number
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      forum_thread_reads: {
        Row: {
          last_read_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          last_read_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          last_read_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_thread_reads_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      founder_supporter_waitlist: {
        Row: {
          consent_given_at: string
          contact_type: string | null
          country: string | null
          created_at: string
          discord_handle: string | null
          email: string | null
          fairness_red_line: string | null
          follow_up_consent: boolean
          id: string
          intent_score: number | null
          interest_level: string
          main_reason: string | null
          notes: string | null
          preferred_tier: string
          source: string | null
          status: string
          utm_campaign: string | null
          utm_medium: string | null
          valued_benefits: string[] | null
        }
        Insert: {
          consent_given_at: string
          contact_type?: string | null
          country?: string | null
          created_at?: string
          discord_handle?: string | null
          email?: string | null
          fairness_red_line?: string | null
          follow_up_consent?: boolean
          id?: string
          intent_score?: number | null
          interest_level: string
          main_reason?: string | null
          notes?: string | null
          preferred_tier: string
          source?: string | null
          status?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          valued_benefits?: string[] | null
        }
        Update: {
          consent_given_at?: string
          contact_type?: string | null
          country?: string | null
          created_at?: string
          discord_handle?: string | null
          email?: string | null
          fairness_red_line?: string | null
          follow_up_consent?: boolean
          id?: string
          intent_score?: number | null
          interest_level?: string
          main_reason?: string | null
          notes?: string | null
          preferred_tier?: string
          source?: string | null
          status?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          valued_benefits?: string[] | null
        }
        Relationships: []
      }
      global_rank_season_start_snapshot: {
        Row: {
          captured_at: string
          global_rank: number | null
          season_id: string
          team_id: string
        }
        Insert: {
          captured_at?: string
          global_rank?: number | null
          season_id: string
          team_id: string
        }
        Update: {
          captured_at?: string
          global_rank?: number | null
          season_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "global_rank_season_start_snapshot_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "global_rank_season_start_snapshot_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_rank_season_start_snapshot_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "global_rank_season_start_snapshot_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      global_rank_weekly_snapshot: {
        Row: {
          captured_at: string
          global_rank: number | null
          team_id: string
        }
        Insert: {
          captured_at?: string
          global_rank?: number | null
          team_id: string
        }
        Update: {
          captured_at?: string
          global_rank?: number | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "global_rank_weekly_snapshot_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "global_rank_weekly_snapshot_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_metric_snapshots: {
        Row: {
          active_subscriptions: number
          d1_eligible: number
          d1_retention_pct: number | null
          d1_returning: number
          d30_eligible: number
          d30_retention_pct: number | null
          d30_returning: number
          d7_eligible: number
          d7_retention_pct: number | null
          d7_returning: number
          dau: number
          generated_at: string
          ltv_avg_cents: number | null
          ltv_total_cents: number
          mau: number
          nps_detractors: number
          nps_passives: number
          nps_promoters: number
          nps_response_count: number
          nps_score: number | null
          paying_customers: number
          snapshot_date: string
          total_registered: number
          wau: number
        }
        Insert: {
          active_subscriptions?: number
          d1_eligible?: number
          d1_retention_pct?: number | null
          d1_returning?: number
          d30_eligible?: number
          d30_retention_pct?: number | null
          d30_returning?: number
          d7_eligible?: number
          d7_retention_pct?: number | null
          d7_returning?: number
          dau?: number
          generated_at?: string
          ltv_avg_cents?: number | null
          ltv_total_cents?: number
          mau?: number
          nps_detractors?: number
          nps_passives?: number
          nps_promoters?: number
          nps_response_count?: number
          nps_score?: number | null
          paying_customers?: number
          snapshot_date: string
          total_registered?: number
          wau?: number
        }
        Update: {
          active_subscriptions?: number
          d1_eligible?: number
          d1_retention_pct?: number | null
          d1_returning?: number
          d30_eligible?: number
          d30_retention_pct?: number | null
          d30_returning?: number
          d7_eligible?: number
          d7_retention_pct?: number | null
          d7_returning?: number
          dau?: number
          generated_at?: string
          ltv_avg_cents?: number | null
          ltv_total_cents?: number
          mau?: number
          nps_detractors?: number
          nps_passives?: number
          nps_promoters?: number
          nps_response_count?: number
          nps_score?: number | null
          paying_customers?: number
          snapshot_date?: string
          total_registered?: number
          wau?: number
        }
        Relationships: []
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      identity_events: {
        Row: {
          accept_language: string | null
          created_at: string
          entity_id: string | null
          event_type: string
          first_seen_at: string | null
          id: string
          ip: unknown
          ip_prefix: unknown
          metadata: Json | null
          team_id: string | null
          timezone_offset_minutes: number | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accept_language?: string | null
          created_at?: string
          entity_id?: string | null
          event_type: string
          first_seen_at?: string | null
          id?: string
          ip?: unknown
          ip_prefix?: unknown
          metadata?: Json | null
          team_id?: string | null
          timezone_offset_minutes?: number | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accept_language?: string | null
          created_at?: string
          entity_id?: string | null
          event_type?: string
          first_seen_at?: string | null
          id?: string
          ip?: unknown
          ip_prefix?: unknown
          metadata?: Json | null
          team_id?: string | null
          timezone_offset_minutes?: number | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "identity_events_team_id_fkey"
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
      launch_waitlist: {
        Row: {
          consent_given_at: string
          created_at: string
          email: string
          id: string
          name: string | null
          source: string | null
          utm_campaign: string | null
          utm_medium: string | null
        }
        Insert: {
          consent_given_at: string
          created_at?: string
          email: string
          id?: string
          name?: string | null
          source?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
        }
        Update: {
          consent_given_at?: string
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          source?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
        }
        Relationships: []
      }
      league_divisions: {
        Row: {
          id: number
          label: string
          pool_index: number
          tier: number
        }
        Insert: {
          id?: number
          label: string
          pool_index: number
          tier: number
        }
        Update: {
          id?: number
          label?: string
          pool_index?: number
          tier?: number
        }
        Relationships: []
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
          accrued_interest: number
          amount_remaining: number
          created_at: string | null
          id: string
          interest_rate: number
          last_interest_season_id: string | null
          loan_type: string
          origination_fee: number
          principal: number
          season_id: string | null
          seasons_remaining: number
          seasons_total: number
          status: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          accrued_interest?: number
          amount_remaining: number
          created_at?: string | null
          id?: string
          interest_rate: number
          last_interest_season_id?: string | null
          loan_type: string
          origination_fee: number
          principal: number
          season_id?: string | null
          seasons_remaining: number
          seasons_total: number
          status?: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          accrued_interest?: number
          amount_remaining?: number
          created_at?: string | null
          id?: string
          interest_rate?: number
          last_interest_season_id?: string | null
          loan_type?: string
          origination_fee?: number
          principal?: number
          season_id?: string | null
          seasons_remaining?: number
          seasons_total?: number
          status?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loans_last_interest_season_id_fkey"
            columns: ["last_interest_season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "loans_last_interest_season_id_fkey"
            columns: ["last_interest_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "loans_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
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
      market_value_level_correction_apply_log: {
        Row: {
          applied_at: string
          applied_by: string | null
          bank_rate_after: number | null
          bank_rate_before: number | null
          c: number
          gate_measured_date: string | null
          id: string
          notes: string | null
          population_size: number
          riders_changed: number
          total_value_after: number | null
          total_value_before: number | null
          wage_a_after: number | null
          wage_a_before: number | null
          wage_leg_applied: boolean
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          bank_rate_after?: number | null
          bank_rate_before?: number | null
          c: number
          gate_measured_date?: string | null
          id?: string
          notes?: string | null
          population_size: number
          riders_changed: number
          total_value_after?: number | null
          total_value_before?: number | null
          wage_a_after?: number | null
          wage_a_before?: number | null
          wage_leg_applied?: boolean
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          bank_rate_after?: number | null
          bank_rate_before?: number | null
          c?: number
          gate_measured_date?: string | null
          id?: string
          notes?: string | null
          population_size?: number
          riders_changed?: number
          total_value_after?: number | null
          total_value_before?: number | null
          wage_a_after?: number | null
          wage_a_before?: number | null
          wage_leg_applied?: boolean
        }
        Relationships: []
      }
      market_value_level_correction_gate_log: {
        Row: {
          c_candidate: number | null
          completed_at: string | null
          created_at: string
          gate_reason: string | null
          gate_reason_text: string | null
          gate_status: string | null
          id: string
          measured_date: string
          median_price_over_anchor_90d: number | null
          min_qualified_trades: number | null
          n_qualified_90d: number | null
          rolling_medians: Json | null
          stability_band: number | null
        }
        Insert: {
          c_candidate?: number | null
          completed_at?: string | null
          created_at?: string
          gate_reason?: string | null
          gate_reason_text?: string | null
          gate_status?: string | null
          id?: string
          measured_date: string
          median_price_over_anchor_90d?: number | null
          min_qualified_trades?: number | null
          n_qualified_90d?: number | null
          rolling_medians?: Json | null
          stability_band?: number | null
        }
        Update: {
          c_candidate?: number | null
          completed_at?: string | null
          created_at?: string
          gate_reason?: string | null
          gate_reason_text?: string | null
          gate_status?: string | null
          id?: string
          measured_date?: string
          median_price_over_anchor_90d?: number | null
          min_qualified_trades?: number | null
          n_qualified_90d?: number | null
          rolling_medians?: Json | null
          stability_band?: number | null
        }
        Relationships: []
      }
      market_value_level_correction_rider_receipts: {
        Row: {
          applied_at: string
          apply_log_id: string
          c: number
          id: string
          new_value: number
          old_value: number
          rider_id: string
        }
        Insert: {
          applied_at?: string
          apply_log_id: string
          c: number
          id?: string
          new_value: number
          old_value: number
          rider_id: string
        }
        Update: {
          applied_at?: string
          apply_log_id?: string
          c?: number
          id?: string
          new_value?: number
          old_value?: number
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_value_level_correction_rider_receipts_apply_log_id_fkey"
            columns: ["apply_log_id"]
            isOneToOne: false
            referencedRelation: "market_value_level_correction_apply_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_value_level_correction_rider_receipts_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      market_value_sunday_sweep_log: {
        Row: {
          changed: number
          completed_at: string | null
          created_at: string
          global_weight: number | null
          id: string
          sales_index_size: number | null
          scanned: number
          sweep_date: string
          weekly_cap: number | null
          written: number
        }
        Insert: {
          changed?: number
          completed_at?: string | null
          created_at?: string
          global_weight?: number | null
          id?: string
          sales_index_size?: number | null
          scanned?: number
          sweep_date: string
          weekly_cap?: number | null
          written?: number
        }
        Update: {
          changed?: number
          completed_at?: string | null
          created_at?: string
          global_weight?: number | null
          id?: string
          sales_index_size?: number | null
          scanned?: number
          sweep_date?: string
          weekly_cap?: number | null
          written?: number
        }
        Relationships: []
      }
      matview_refresh_heartbeat: {
        Row: {
          matview_group: string
          refreshed_at: string
        }
        Insert: {
          matview_group: string
          refreshed_at?: string
        }
        Update: {
          matview_group?: string
          refreshed_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          metadata: Json | null
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
          metadata?: Json | null
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
          metadata?: Json | null
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
      nps_responses: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          score: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          score: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nps_responses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_alert_state: {
        Row: {
          alert_key: string
          last_alerted_at: string | null
          signature: string
          updated_at: string
        }
        Insert: {
          alert_key: string
          last_alerted_at?: string | null
          signature?: string
          updated_at?: string
        }
        Update: {
          alert_key?: string
          last_alerted_at?: string | null
          signature?: string
          updated_at?: string
        }
        Relationships: []
      }
      ops_notices: {
        Row: {
          active: boolean
          body_da: string
          body_en: string
          created_at: string
          ends_at: string | null
          id: string
          severity: string
          starts_at: string
          title_da: string
          title_en: string
        }
        Insert: {
          active?: boolean
          body_da: string
          body_en: string
          created_at?: string
          ends_at?: string | null
          id?: string
          severity: string
          starts_at?: string
          title_da: string
          title_en: string
        }
        Update: {
          active?: boolean
          body_da?: string
          body_en?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          severity?: string
          starts_at?: string
          title_da?: string
          title_en?: string
        }
        Relationships: []
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
      player_events: {
        Row: {
          created_at: string
          event_data: Json
          event_name: string
          id: number
          team_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_data?: Json
          event_name: string
          id?: number
          team_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_data?: Json
          event_name?: string
          id?: number
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "player_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_feedback: {
        Row: {
          category: string
          created_at: string
          id: string
          message: string
          page_path: string | null
          replied_at: string | null
          replied_by: string | null
          reply_message: string | null
          seq: number
          status: string
          status_changed_at: string | null
          team_id: string | null
          user_agent: string | null
          user_id: string
          viewport: string | null
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          message: string
          page_path?: string | null
          replied_at?: string | null
          replied_by?: string | null
          reply_message?: string | null
          seq?: number
          status?: string
          status_changed_at?: string | null
          team_id?: string | null
          user_agent?: string | null
          user_id: string
          viewport?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          message?: string
          page_path?: string | null
          replied_at?: string | null
          replied_by?: string | null
          reply_message?: string | null
          seq?: number
          status?: string
          status_changed_at?: string | null
          team_id?: string | null
          user_agent?: string | null
          user_id?: string
          viewport?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_feedback_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "player_feedback_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
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
      race_balance_drift_daily: {
        Row: {
          computed_at: string
          metric_date: string
          metrics: Json
          statuses: Json
        }
        Insert: {
          computed_at?: string
          metric_date: string
          metrics: Json
          statuses: Json
        }
        Update: {
          computed_at?: string
          metric_date?: string
          metrics?: Json
          statuses?: Json
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
      race_entries: {
        Row: {
          binding_span: unknown
          created_at: string
          is_auto_filled: boolean
          race_id: string
          race_role: string
          rider_id: string
          team_id: string | null
        }
        Insert: {
          binding_span?: unknown
          created_at?: string
          is_auto_filled?: boolean
          race_id: string
          race_role?: string
          rider_id: string
          team_id?: string | null
        }
        Update: {
          binding_span?: unknown
          created_at?: string
          is_auto_filled?: boolean
          race_id?: string
          race_role?: string
          rider_id?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "race_entries_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_entries_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "race_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      race_entry_clears: {
        Row: {
          cleared_at: string
          race_id: string
          team_id: string
        }
        Insert: {
          cleared_at?: string
          race_id: string
          team_id: string
        }
        Update: {
          cleared_at?: string
          race_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_entry_clears_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_entry_clears_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "race_entry_clears_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      race_entry_days: {
        Row: {
          game_day: number
          race_id: string
          rider_id: string
          season_id: string
          team_id: string
        }
        Insert: {
          game_day: number
          race_id: string
          rider_id: string
          season_id: string
          team_id: string
        }
        Update: {
          game_day?: number
          race_id?: string
          rider_id?: string
          season_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_entry_days_entry_fkey"
            columns: ["race_id", "rider_id"]
            isOneToOne: false
            referencedRelation: "race_entries"
            referencedColumns: ["race_id", "rider_id"]
          },
        ]
      }
      race_incidents: {
        Row: {
          created_at: string
          id: string
          injury_days: number | null
          kind: string
          outcome: string
          race_id: string
          rider_id: string
          stage_number: number
          time_loss_seconds: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          injury_days?: number | null
          kind: string
          outcome: string
          race_id: string
          rider_id: string
          stage_number: number
          time_loss_seconds?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          injury_days?: number | null
          kind?: string
          outcome?: string
          race_id?: string
          rider_id?: string
          stage_number?: number
          time_loss_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "race_incidents_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_incidents_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      race_point_cascade: {
        Row: {
          factor: number
          race_class: string
          result_type: string
          updated_at: string | null
        }
        Insert: {
          factor: number
          race_class: string
          result_type: string
          updated_at?: string | null
        }
        Update: {
          factor?: number
          race_class?: string
          result_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      race_point_master: {
        Row: {
          anchor: number
          master_class: string
          ratio: number | null
          ratio_ref: string | null
          result_type: string
          updated_at: string | null
        }
        Insert: {
          anchor: number
          master_class: string
          ratio?: number | null
          ratio_ref?: string | null
          result_type: string
          updated_at?: string | null
        }
        Update: {
          anchor?: number
          master_class?: string
          ratio?: number | null
          ratio_ref?: string | null
          result_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      race_point_template: {
        Row: {
          race_class: string
          rank: number
          result_type: string
          updated_at: string | null
          weight: number
        }
        Insert: {
          race_class: string
          rank: number
          result_type: string
          updated_at?: string | null
          weight: number
        }
        Update: {
          race_class?: string
          rank?: number
          result_type?: string
          updated_at?: string | null
          weight?: number
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
      race_pool: {
        Row: {
          country: string | null
          created_at: string
          date_text: string | null
          external_id: string
          id: string
          name: string
          race_class: string
          race_type: string
          retired_at: string | null
          stages: number
          terrain_archetype: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          date_text?: string | null
          external_id: string
          id?: string
          name: string
          race_class: string
          race_type: string
          retired_at?: string | null
          stages: number
          terrain_archetype?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          date_text?: string | null
          external_id?: string
          id?: string
          name?: string
          race_class?: string
          race_type?: string
          retired_at?: string | null
          stages?: number
          terrain_archetype?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      race_results: {
        Row: {
          bonus_seconds: number | null
          breakaway_caught: boolean
          entrant_key: string | null
          entrant_uid: string | null
          finish_time: string | null
          id: string
          imported_at: string | null
          in_breakaway: boolean
          kom_points: number | null
          points_earned: number | null
          prize_money: number | null
          race_id: string | null
          rank: number | null
          result_type: string
          rider_id: string | null
          rider_name: string | null
          sprint_points: number | null
          stage_number: number | null
          team_id: string | null
          team_name: string | null
        }
        Insert: {
          bonus_seconds?: number | null
          breakaway_caught?: boolean
          entrant_key?: string | null
          entrant_uid?: string | null
          finish_time?: string | null
          id?: string
          imported_at?: string | null
          in_breakaway?: boolean
          kom_points?: number | null
          points_earned?: number | null
          prize_money?: number | null
          race_id?: string | null
          rank?: number | null
          result_type: string
          rider_id?: string | null
          rider_name?: string | null
          sprint_points?: number | null
          stage_number?: number | null
          team_id?: string | null
          team_name?: string | null
        }
        Update: {
          bonus_seconds?: number | null
          breakaway_caught?: boolean
          entrant_key?: string | null
          entrant_uid?: string | null
          finish_time?: string | null
          id?: string
          imported_at?: string | null
          in_breakaway?: boolean
          kom_points?: number | null
          points_earned?: number | null
          prize_money?: number | null
          race_id?: string | null
          rank?: number | null
          result_type?: string
          rider_id?: string | null
          rider_name?: string | null
          sprint_points?: number | null
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      race_simulation_rider_scores: {
        Row: {
          components: Json
          rank: number
          rider_id: string
          run_id: string
        }
        Insert: {
          components: Json
          rank: number
          rider_id: string
          run_id: string
        }
        Update: {
          components?: Json
          rank?: number
          rider_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_simulation_rider_scores_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "race_simulation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      race_simulation_runs: {
        Row: {
          created_at: string
          engine_version: number
          entrant_snapshot: Json
          id: string
          input_checksum: number
          race_id: string
          salt_version: number | null
          seed: number
          source: string | null
          stage_number: number
        }
        Insert: {
          created_at?: string
          engine_version?: number
          entrant_snapshot: Json
          id?: string
          input_checksum: number
          race_id: string
          salt_version?: number | null
          seed: number
          source?: string | null
          stage_number?: number
        }
        Update: {
          created_at?: string
          engine_version?: number
          entrant_snapshot?: Json
          id?: string
          input_checksum?: number
          race_id?: string
          salt_version?: number | null
          seed?: number
          source?: string | null
          stage_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "race_simulation_runs_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_stage_claims: {
        Row: {
          claimed_at: string
          claimed_by: string | null
          race_id: string
          stage_index: number
        }
        Insert: {
          claimed_at?: string
          claimed_by?: string | null
          race_id: string
          stage_index: number
        }
        Update: {
          claimed_at?: string
          claimed_by?: string | null
          race_id?: string
          stage_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "race_stage_claims_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_stage_moments: {
        Row: {
          created_at: string
          id: string
          moment_key: string
          params: Json
          race_id: string
          rider_ids: string[]
          significance: number
          stage_number: number
          team_ids: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          moment_key: string
          params?: Json
          race_id: string
          rider_ids?: string[]
          significance?: number
          stage_number: number
          team_ids?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          moment_key?: string
          params?: Json
          race_id?: string
          rider_ids?: string[]
          significance?: number
          stage_number?: number
          team_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "race_stage_moments_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_stage_passages: {
        Row: {
          bonus_seconds: number
          climb_category: string | null
          id: string
          passage_rank: number
          points: number
          race_id: string
          rider_id: string | null
          rider_name: string | null
          stage_number: number
          team_id: string | null
          waypoint_index: number
          waypoint_kind: string
          waypoint_km: number | null
          waypoint_name: string | null
        }
        Insert: {
          bonus_seconds?: number
          climb_category?: string | null
          id?: string
          passage_rank: number
          points?: number
          race_id: string
          rider_id?: string | null
          rider_name?: string | null
          stage_number?: number
          team_id?: string | null
          waypoint_index: number
          waypoint_kind: string
          waypoint_km?: number | null
          waypoint_name?: string | null
        }
        Update: {
          bonus_seconds?: number
          climb_category?: string | null
          id?: string
          passage_rank?: number
          points?: number
          race_id?: string
          rider_id?: string | null
          rider_name?: string | null
          stage_number?: number
          team_id?: string | null
          waypoint_index?: number
          waypoint_kind?: string
          waypoint_km?: number | null
          waypoint_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "race_stage_passages_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_stage_profiles: {
        Row: {
          climbs: Json
          demand_vector: Json
          distance_km: number | null
          elevation_gain_m: number | null
          finale_type: string | null
          generated_at: string
          generator_version: number
          id: string
          is_manual: boolean
          profile_type: string
          race_id: string
          sectors: Json
          segments: Json | null
          sprints: Json
          stage_number: number
          weather: Json | null
        }
        Insert: {
          climbs?: Json
          demand_vector: Json
          distance_km?: number | null
          elevation_gain_m?: number | null
          finale_type?: string | null
          generated_at?: string
          generator_version?: number
          id?: string
          is_manual?: boolean
          profile_type: string
          race_id: string
          sectors?: Json
          segments?: Json | null
          sprints?: Json
          stage_number?: number
          weather?: Json | null
        }
        Update: {
          climbs?: Json
          demand_vector?: Json
          distance_km?: number | null
          elevation_gain_m?: number | null
          finale_type?: string | null
          generated_at?: string
          generator_version?: number
          id?: string
          is_manual?: boolean
          profile_type?: string
          race_id?: string
          sectors?: Json
          segments?: Json | null
          sprints?: Json
          stage_number?: number
          weather?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "race_stage_profiles_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_stage_roles: {
        Row: {
          effort: string
          race_id: string
          race_role: string
          rider_id: string
          stage_number: number
          updated_at: string
        }
        Insert: {
          effort?: string
          race_id: string
          race_role: string
          rider_id: string
          stage_number: number
          updated_at?: string
        }
        Update: {
          effort?: string
          race_id?: string
          race_role?: string
          rider_id?: string
          stage_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_stage_roles_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_stage_roles_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      race_stage_schedule: {
        Row: {
          created_at: string
          game_day: number | null
          race_id: string
          scheduled_at: string
          stage_number: number
        }
        Insert: {
          created_at?: string
          game_day?: number | null
          race_id: string
          scheduled_at: string
          stage_number: number
        }
        Update: {
          created_at?: string
          game_day?: number | null
          race_id?: string
          scheduled_at?: string
          stage_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "race_stage_schedule_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_stage_timelines: {
        Row: {
          created_at: string
          events: Json
          race_id: string
          stage_number: number
          timeline_version: number
        }
        Insert: {
          created_at?: string
          events?: Json
          race_id: string
          stage_number: number
          timeline_version?: number
        }
        Update: {
          created_at?: string
          events?: Json
          race_id?: string
          stage_number?: number
          timeline_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "race_stage_timelines_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_team_orders: {
        Row: {
          breakaway_stance: string
          created_at: string
          locked_at: string | null
          race_id: string
          riders: Json
          stage_number: number
          team_id: string
          updated_at: string
        }
        Insert: {
          breakaway_stance?: string
          created_at?: string
          locked_at?: string | null
          race_id: string
          riders?: Json
          stage_number: number
          team_id: string
          updated_at?: string
        }
        Update: {
          breakaway_stance?: string
          created_at?: string
          locked_at?: string | null
          race_id?: string
          riders?: Json
          stage_number?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_team_orders_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_team_orders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "race_team_orders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      race_withdrawals: {
        Row: {
          race_id: string
          team_id: string
          withdrawn_at: string
          withdrawn_reason: string | null
        }
        Insert: {
          race_id: string
          team_id: string
          withdrawn_at?: string
          withdrawn_reason?: string | null
        }
        Update: {
          race_id?: string
          team_id?: string
          withdrawn_at?: string
          withdrawn_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "race_withdrawals_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_withdrawals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "race_withdrawals_team_id_fkey"
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
          edition_year: number | null
          game_day_start: number | null
          id: string
          league_division_id: number | null
          name: string
          pool_race_id: string | null
          prize_paid_at: string | null
          race_class: string | null
          race_type: string | null
          scheduled_for: string | null
          season_id: string | null
          stages: number | null
          stages_completed: number
          status: string | null
        }
        Insert: {
          created_at?: string | null
          edition_year?: number | null
          game_day_start?: number | null
          id?: string
          league_division_id?: number | null
          name: string
          pool_race_id?: string | null
          prize_paid_at?: string | null
          race_class?: string | null
          race_type?: string | null
          scheduled_for?: string | null
          season_id?: string | null
          stages?: number | null
          stages_completed?: number
          status?: string | null
        }
        Update: {
          created_at?: string | null
          edition_year?: number | null
          game_day_start?: number | null
          id?: string
          league_division_id?: number | null
          name?: string
          pool_race_id?: string | null
          prize_paid_at?: string | null
          race_class?: string | null
          race_type?: string | null
          scheduled_for?: string | null
          season_id?: string | null
          stages?: number | null
          stages_completed?: number
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "races_league_division_id_fkey"
            columns: ["league_division_id"]
            isOneToOne: false
            referencedRelation: "league_divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "races_pool_race_id_fkey"
            columns: ["pool_race_id"]
            isOneToOne: false
            referencedRelation: "race_pool"
            referencedColumns: ["id"]
          },
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
      rider_caps_3591_backup_20260813: {
        Row: {
          ability_caps_before: Json | null
          captured_at: string
          rider_id: string
        }
        Insert: {
          ability_caps_before?: Json | null
          captured_at?: string
          rider_id: string
        }
        Update: {
          ability_caps_before?: Json | null
          captured_at?: string
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_caps_3591_backup_20260813_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: true
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_caps_3746_backup_20260816: {
        Row: {
          ability_caps_before: Json | null
          captured_at: string
          rider_id: string
        }
        Insert: {
          ability_caps_before?: Json | null
          captured_at?: string
          rider_id: string
        }
        Update: {
          ability_caps_before?: Json | null
          captured_at?: string
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_caps_3746_backup_20260816_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: true
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_career_events: {
        Row: {
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          occurred_at: string
          params: Json
          race_id: string | null
          rider_id: string
          rider_name: string | null
          season_number: number | null
          significance: number
          team_id: string | null
          team_name: string | null
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          event_type: string
          id?: string
          occurred_at?: string
          params?: Json
          race_id?: string | null
          rider_id: string
          rider_name?: string | null
          season_number?: number | null
          significance?: number
          team_id?: string | null
          team_name?: string | null
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          occurred_at?: string
          params?: Json
          race_id?: string | null
          rider_id?: string
          rider_name?: string | null
          season_number?: number | null
          significance?: number
          team_id?: string | null
          team_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_career_events_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_career_events_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_career_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "rider_career_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_condition: {
        Row: {
          fatigue: number
          form: number
          injured_until: string | null
          injury_cause: string | null
          rider_id: string
          updated_at: string
        }
        Insert: {
          fatigue?: number
          form?: number
          injured_until?: string | null
          injury_cause?: string | null
          rider_id: string
          updated_at?: string
        }
        Update: {
          fatigue?: number
          form?: number
          injured_until?: string | null
          injury_cause?: string | null
          rider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_condition_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: true
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_derived_abilities: {
        Row: {
          ability_caps: Json | null
          ability_progress: Json | null
          acceleration: number
          aggression: number | null
          climbing: number
          cobblestone: number
          descending: number | null
          durability: number | null
          endurance: number
          flat: number | null
          formula_version: number
          generated_at: string
          hidden_potential: number | null
          positioning: number
          prolog: number | null
          punch: number
          recovery: number
          rider_id: string
          sprint: number
          tactics: number
          tempo: number | null
          time_trial: number
        }
        Insert: {
          ability_caps?: Json | null
          ability_progress?: Json | null
          acceleration: number
          aggression?: number | null
          climbing: number
          cobblestone: number
          descending?: number | null
          durability?: number | null
          endurance: number
          flat?: number | null
          formula_version?: number
          generated_at?: string
          hidden_potential?: number | null
          positioning: number
          prolog?: number | null
          punch: number
          recovery: number
          rider_id: string
          sprint: number
          tactics: number
          tempo?: number | null
          time_trial: number
        }
        Update: {
          ability_caps?: Json | null
          ability_progress?: Json | null
          acceleration?: number
          aggression?: number | null
          climbing?: number
          cobblestone?: number
          descending?: number | null
          durability?: number | null
          endurance?: number
          flat?: number | null
          formula_version?: number
          generated_at?: string
          hidden_potential?: number | null
          positioning?: number
          prolog?: number | null
          punch?: number
          recovery?: number
          rider_id?: string
          sprint?: number
          tactics?: number
          tempo?: number | null
          time_trial?: number
        }
        Relationships: [
          {
            foreignKeyName: "rider_derived_abilities_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: true
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_derived_abilities_3570_backup_20260811: {
        Row: {
          ability_caps: Json | null
          ability_progress: Json | null
          captured_at: string | null
          rider_id: string
        }
        Insert: {
          ability_caps?: Json | null
          ability_progress?: Json | null
          captured_at?: string | null
          rider_id: string
        }
        Update: {
          ability_caps?: Json | null
          ability_progress?: Json | null
          captured_at?: string | null
          rider_id?: string
        }
        Relationships: []
      }
      rider_derived_ability_history: {
        Row: {
          abilities: Json
          created_at: string
          id: string
          rider_id: string
          season_number: number | null
          snapshot_date: string
          source: string
        }
        Insert: {
          abilities: Json
          created_at?: string
          id?: string
          rider_id: string
          season_number?: number | null
          snapshot_date: string
          source: string
        }
        Update: {
          abilities?: Json
          created_at?: string
          id?: string
          rider_id?: string
          season_number?: number | null
          snapshot_date?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_derived_ability_history_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_development_log: {
        Row: {
          abilities: Json
          age: number | null
          base_value: number | null
          created_at: string
          id: string
          retired_this_season: boolean
          rider_id: string
          season_id: string
          season_number: number | null
        }
        Insert: {
          abilities: Json
          age?: number | null
          base_value?: number | null
          created_at?: string
          id?: string
          retired_this_season?: boolean
          rider_id: string
          season_id: string
          season_number?: number | null
        }
        Update: {
          abilities?: Json
          age?: number | null
          base_value?: number | null
          created_at?: string
          id?: string
          retired_this_season?: boolean
          rider_id?: string
          season_id?: string
          season_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_development_log_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_development_log_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "rider_development_log_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_ownership_events: {
        Row: {
          actor_id: string | null
          actor_type: string | null
          created_at: string
          from_team_id: string | null
          id: string
          idempotency_key: string | null
          occurred_at: string
          reason: string
          related_entity_id: string | null
          related_entity_type: string | null
          rider_firstname: string | null
          rider_id: string
          rider_lastname: string | null
          to_team_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string
          from_team_id?: string | null
          id?: string
          idempotency_key?: string | null
          occurred_at?: string
          reason: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          rider_firstname?: string | null
          rider_id: string
          rider_lastname?: string | null
          to_team_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string
          from_team_id?: string | null
          id?: string
          idempotency_key?: string | null
          occurred_at?: string
          reason?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          rider_firstname?: string | null
          rider_id?: string
          rider_lastname?: string | null
          to_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_ownership_events_from_team_id_fkey"
            columns: ["from_team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "rider_ownership_events_from_team_id_fkey"
            columns: ["from_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_ownership_events_to_team_id_fkey"
            columns: ["to_team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "rider_ownership_events_to_team_id_fkey"
            columns: ["to_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_peak_plans: {
        Row: {
          created_at: string
          id: string
          locked_at: string | null
          rider_id: string
          season_id: string
          target_race_id: string | null
          window_end: string
          window_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          locked_at?: string | null
          rider_id: string
          season_id: string
          target_race_id?: string | null
          window_end: string
          window_start: string
        }
        Update: {
          created_at?: string
          id?: string
          locked_at?: string | null
          rider_id?: string
          season_id?: string
          target_race_id?: string | null
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_peak_plans_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_peak_plans_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "rider_peak_plans_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_peak_plans_target_race_id_fkey"
            columns: ["target_race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_physiology_profiles: {
        Row: {
          aero: number | null
          created_at: string
          fatigue_resistance: number
          ftp_watts: number
          ftp_wkg: number
          height_cm: number
          high_intensity_energy_kj: number
          id: string
          pmax_watts: number
          power_10m_wkg: number | null
          power_15s_wkg: number
          power_1m_wkg: number
          power_2m_wkg: number | null
          power_5m_wkg: number
          power_5s_wkg: number
          recovery_rate: number
          rider_id: string
          source: string
          time_to_exhaustion_ftp_min: number
          updated_at: string
          version: number
          vo2max_power_wkg: number
          weight_kg: number
          zone2_power_wkg: number
        }
        Insert: {
          aero?: number | null
          created_at?: string
          fatigue_resistance: number
          ftp_watts: number
          ftp_wkg: number
          height_cm: number
          high_intensity_energy_kj: number
          id?: string
          pmax_watts: number
          power_10m_wkg?: number | null
          power_15s_wkg: number
          power_1m_wkg: number
          power_2m_wkg?: number | null
          power_5m_wkg: number
          power_5s_wkg: number
          recovery_rate: number
          rider_id: string
          source?: string
          time_to_exhaustion_ftp_min: number
          updated_at?: string
          version?: number
          vo2max_power_wkg: number
          weight_kg: number
          zone2_power_wkg: number
        }
        Update: {
          aero?: number | null
          created_at?: string
          fatigue_resistance?: number
          ftp_watts?: number
          ftp_wkg?: number
          height_cm?: number
          high_intensity_energy_kj?: number
          id?: string
          pmax_watts?: number
          power_10m_wkg?: number | null
          power_15s_wkg?: number
          power_1m_wkg?: number
          power_2m_wkg?: number | null
          power_5m_wkg?: number
          power_5s_wkg?: number
          recovery_rate?: number
          rider_id?: string
          source?: string
          time_to_exhaustion_ftp_min?: number
          updated_at?: string
          version?: number
          vo2max_power_wkg?: number
          weight_kg?: number
          zone2_power_wkg?: number
        }
        Relationships: [
          {
            foreignKeyName: "rider_physiology_profiles_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: true
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_profile_views: {
        Row: {
          id: number
          rider_id: string
          user_id: string
          view_date: string
          viewed_at: string
        }
        Insert: {
          id?: number
          rider_id: string
          user_id: string
          view_date?: string
          viewed_at?: string
        }
        Update: {
          id?: number
          rider_id?: string
          user_id?: string
          view_date?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_profile_views_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
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
          acquired_at: string | null
          ai_team_id: string | null
          archetype_draw: Json | null
          base_value: number | null
          birthdate: string | null
          contract_end_season: number | null
          contract_length: number | null
          created_at: string | null
          current_production_value: number | null
          firstname: string
          generation_tag: string | null
          height: number | null
          id: string
          is_academy: boolean
          is_retired: boolean
          is_u25: boolean | null
          lastname: string
          market_value: number | null
          nationality_code: string | null
          owner_is_ai: boolean
          pcm_id: number | null
          peak_suggestions_dismissed_season_id: string | null
          pending_team_id: string | null
          popularity: number | null
          potentiale: number | null
          primary_type: string | null
          prize_earnings_bonus: number
          salary: number | null
          secondary_type: string | null
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
          valuation_type: string | null
          weight: number | null
        }
        Insert: {
          acquired_at?: string | null
          ai_team_id?: string | null
          archetype_draw?: Json | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          current_production_value?: number | null
          firstname: string
          generation_tag?: string | null
          height?: number | null
          id?: string
          is_academy?: boolean
          is_retired?: boolean
          is_u25?: boolean | null
          lastname: string
          market_value?: number | null
          nationality_code?: string | null
          owner_is_ai?: boolean
          pcm_id?: number | null
          peak_suggestions_dismissed_season_id?: string | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number
          salary?: number | null
          secondary_type?: string | null
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
          valuation_type?: string | null
          weight?: number | null
        }
        Update: {
          acquired_at?: string | null
          ai_team_id?: string | null
          archetype_draw?: Json | null
          base_value?: number | null
          birthdate?: string | null
          contract_end_season?: number | null
          contract_length?: number | null
          created_at?: string | null
          current_production_value?: number | null
          firstname?: string
          generation_tag?: string | null
          height?: number | null
          id?: string
          is_academy?: boolean
          is_retired?: boolean
          is_u25?: boolean | null
          lastname?: string
          market_value?: number | null
          nationality_code?: string | null
          owner_is_ai?: boolean
          pcm_id?: number | null
          peak_suggestions_dismissed_season_id?: string | null
          pending_team_id?: string | null
          popularity?: number | null
          potentiale?: number | null
          primary_type?: string | null
          prize_earnings_bonus?: number
          salary?: number | null
          secondary_type?: string | null
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
          valuation_type?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "riders_ai_team_id_fkey"
            columns: ["ai_team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "riders_ai_team_id_fkey"
            columns: ["ai_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riders_peak_suggestions_dismissed_season_id_fkey"
            columns: ["peak_suggestions_dismissed_season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "riders_peak_suggestions_dismissed_season_id_fkey"
            columns: ["peak_suggestions_dismissed_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riders_pending_team_id_fkey"
            columns: ["pending_team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      riders_3570_backup_20260811: {
        Row: {
          archetype_draw: Json | null
          base_value: number | null
          captured_at: string | null
          created_at: string | null
          id: string
          is_retired: boolean | null
          market_value: number | null
          primary_type: string | null
          secondary_type: string | null
          valuation_type: string | null
        }
        Insert: {
          archetype_draw?: Json | null
          base_value?: number | null
          captured_at?: string | null
          created_at?: string | null
          id: string
          is_retired?: boolean | null
          market_value?: number | null
          primary_type?: string | null
          secondary_type?: string | null
          valuation_type?: string | null
        }
        Update: {
          archetype_draw?: Json | null
          base_value?: number | null
          captured_at?: string | null
          created_at?: string | null
          id?: string
          is_retired?: boolean | null
          market_value?: number | null
          primary_type?: string | null
          secondary_type?: string | null
          valuation_type?: string | null
        }
        Relationships: []
      }
      riders_3593_backup_20260811: {
        Row: {
          archetype_draw_before: Json
          captured_at: string
          rider_id: string
          secondary_type_before: string | null
        }
        Insert: {
          archetype_draw_before: Json
          captured_at?: string
          rider_id: string
          secondary_type_before?: string | null
        }
        Update: {
          archetype_draw_before?: Json
          captured_at?: string
          rider_id?: string
          secondary_type_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "riders_3593_backup_20260811_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: true
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      riders_type_backfill_snapshot_20260805: {
        Row: {
          base_value: number | null
          id: string | null
          market_value: number | null
          primary_type: string | null
          secondary_type: string | null
          snapshot_at: string | null
          valuation_type: string | null
        }
        Insert: {
          base_value?: number | null
          id?: string | null
          market_value?: number | null
          primary_type?: string | null
          secondary_type?: string | null
          snapshot_at?: string | null
          valuation_type?: string | null
        }
        Update: {
          base_value?: number | null
          id?: string | null
          market_value?: number | null
          primary_type?: string | null
          secondary_type?: string | null
          snapshot_at?: string | null
          valuation_type?: string | null
        }
        Relationships: []
      }
      roadmap_items: {
        Row: {
          approved: boolean
          created_at: string
          engine: string
          id: string
          shipped_at: string | null
          sort_order: number
          status: string
          title_da: string
          title_en: string
          updated_at: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          engine: string
          id?: string
          shipped_at?: string | null
          sort_order?: number
          status?: string
          title_da: string
          title_en: string
          updated_at?: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          engine?: string
          id?: string
          shipped_at?: string | null
          sort_order?: number
          status?: string
          title_da?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: []
      }
      roadmap_votes: {
        Row: {
          created_at: string
          id: number
          idea_score: number
          importance_score: number
          item_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          idea_score: number
          importance_score: number
          item_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          idea_score?: number
          importance_score?: number
          item_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_votes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "roadmap_item_scores"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "roadmap_votes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "roadmap_items"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          applied_at: string
          filename: string
        }
        Insert: {
          applied_at?: string
          filename: string
        }
        Update: {
          applied_at?: string
          filename?: string
        }
        Relationships: []
      }
      scout_actions: {
        Row: {
          created_at: string
          id: string
          rider_id: string
          season_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          rider_id: string
          season_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          rider_id?: string
          season_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scout_actions_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_actions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "scout_actions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_actions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "scout_actions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_assignments: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          kind: string
          mission_criteria: Json | null
          ready_on: string
          result: Json | null
          rider_id: string | null
          season_id: string | null
          staff_id: string | null
          started_on: string
          status: string
          target_level: number | null
          team_id: string
          travel_cost: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          kind: string
          mission_criteria?: Json | null
          ready_on: string
          result?: Json | null
          rider_id?: string | null
          season_id?: string | null
          staff_id?: string | null
          started_on: string
          status?: string
          target_level?: number | null
          team_id: string
          travel_cost?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          mission_criteria?: Json | null
          ready_on?: string
          result?: Json | null
          rider_id?: string | null
          season_id?: string | null
          staff_id?: string | null
          started_on?: string
          status?: string
          target_level?: number | null
          team_id?: string
          travel_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "scout_assignments_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_assignments_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "scout_assignments_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "team_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "scout_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_sweep_runs: {
        Row: {
          created_at: string
          team_id: string
          tick_date: string
        }
        Insert: {
          created_at?: string
          team_id: string
          tick_date: string
        }
        Update: {
          created_at?: string
          team_id?: string
          tick_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "scout_sweep_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "scout_sweep_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      season_documentaries: {
        Row: {
          deterministic_da: Json
          deterministic_en: Json
          facts: Json
          generated_at: string
          llm_da: string | null
          llm_en: string | null
          llm_model: string | null
          season_id: string
          source: string
          team_id: string
          updated_at: string
        }
        Insert: {
          deterministic_da?: Json
          deterministic_en?: Json
          facts?: Json
          generated_at?: string
          llm_da?: string | null
          llm_en?: string | null
          llm_model?: string | null
          season_id: string
          source?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          deterministic_da?: Json
          deterministic_en?: Json
          facts?: Json
          generated_at?: string
          llm_da?: string | null
          llm_en?: string | null
          llm_model?: string | null
          season_id?: string
          source?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_documentaries_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "season_documentaries_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_documentaries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "season_documentaries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      season_end_claims: {
        Row: {
          claimed_at: string
          season_id: string
        }
        Insert: {
          claimed_at?: string
          season_id: string
        }
        Update: {
          claimed_at?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_end_claims_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "season_end_claims_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      season_form_reset_runs: {
        Row: {
          avg_after: number | null
          avg_before: number | null
          changed: number | null
          completed_at: string | null
          mode: string
          riders: number | null
          season_id: string
          started_at: string
        }
        Insert: {
          avg_after?: number | null
          avg_before?: number | null
          changed?: number | null
          completed_at?: string | null
          mode: string
          riders?: number | null
          season_id: string
          started_at?: string
        }
        Update: {
          avg_after?: number | null
          avg_before?: number | null
          changed?: number | null
          completed_at?: string | null
          mode?: string
          riders?: number | null
          season_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_form_reset_runs_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "season_form_reset_runs_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: true
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      season_standings: {
        Row: {
          division: number
          gc_wins: number | null
          id: string
          league_division_id: number | null
          penalty_points: number
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
          league_division_id?: number | null
          penalty_points?: number
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
          league_division_id?: number | null
          penalty_points?: number
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
            foreignKeyName: "season_standings_league_division_id_fkey"
            columns: ["league_division_id"]
            isOneToOne: false
            referencedRelation: "league_divisions"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
          single_race_boost: string[] | null
          stage_race_priority: string[] | null
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
          single_race_boost?: string[] | null
          stage_race_priority?: string[] | null
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
          single_race_boost?: string[] | null
          stage_race_priority?: string[] | null
          start_date?: string | null
          status?: string | null
        }
        Relationships: []
      }
      signup_attribution: {
        Row: {
          first_seen_at: string | null
          landing_path: string | null
          referrer: string | null
          signed_up_at: string
          user_id: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          first_seen_at?: string | null
          landing_path?: string | null
          referrer?: string | null
          signed_up_at?: string
          user_id: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          first_seen_at?: string | null
          landing_path?: string | null
          referrer?: string | null
          signed_up_at?: string
          user_id?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      sponsor_contracts: {
        Row: {
          activated_at: string | null
          bonus_clauses: Json
          created_at: string
          expires_after_season: number
          guaranteed_base: number
          guaranteed_fraction: number | null
          id: string
          length_seasons: number
          per_race_day_rate: number
          race_day_share: number | null
          results_bonus_paid: number
          sponsor_name: string
          start_season: number
          status: string
          team_id: string
          variant: string | null
        }
        Insert: {
          activated_at?: string | null
          bonus_clauses?: Json
          created_at?: string
          expires_after_season: number
          guaranteed_base: number
          guaranteed_fraction?: number | null
          id?: string
          length_seasons: number
          per_race_day_rate?: number
          race_day_share?: number | null
          results_bonus_paid?: number
          sponsor_name: string
          start_season: number
          status?: string
          team_id: string
          variant?: string | null
        }
        Update: {
          activated_at?: string | null
          bonus_clauses?: Json
          created_at?: string
          expires_after_season?: number
          guaranteed_base?: number
          guaranteed_fraction?: number | null
          id?: string
          length_seasons?: number
          per_race_day_rate?: number
          race_day_share?: number | null
          results_bonus_paid?: number
          sponsor_name?: string
          start_season?: number
          status?: string
          team_id?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_contracts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "sponsor_contracts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_derived_abilities: {
        Row: {
          created_at: string
          dimensions: Json
          formula_version: number
          levels: Json
          overall: number
          role_skills: Json
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dimensions?: Json
          formula_version?: number
          levels?: Json
          overall: number
          role_skills?: Json
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dimensions?: Json
          formula_version?: number
          levels?: Json
          overall?: number
          role_skills?: Json
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_derived_abilities_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "team_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          alunta_customer_id: string | null
          alunta_subscription_id: string | null
          created_at: string
          current_period_end: string | null
          id: string
          is_founder: boolean
          last_event_at: string | null
          last_event_id: string | null
          plan_interval: string | null
          status: string
          team_id: string
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          alunta_customer_id?: string | null
          alunta_subscription_id?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          is_founder?: boolean
          last_event_at?: string | null
          last_event_id?: string | null
          plan_interval?: string | null
          status?: string
          team_id: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          alunta_customer_id?: string | null
          alunta_subscription_id?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          is_founder?: boolean
          last_event_at?: string | null
          last_event_id?: string | null
          plan_interval?: string | null
          status?: string
          team_id?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "subscriptions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      team_board_members: {
        Row: {
          alignment_score: number
          archetype_key: string
          assigned_at: string
          id: string
          is_chairman: boolean
          selection_kind: string
          team_id: string
        }
        Insert: {
          alignment_score?: number
          archetype_key: string
          assigned_at?: string
          id?: string
          is_chairman?: boolean
          selection_kind: string
          team_id: string
        }
        Update: {
          alignment_score?: number
          archetype_key?: string
          assigned_at?: string
          id?: string
          is_chairman?: boolean
          selection_kind?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_board_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_board_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_dna: {
        Row: {
          created_at: string
          emoji: string
          goal_weighting: Json
          key: string
          label: string
          long_description: string
          member_alignment_bonus: Json
          national_affinity: string[]
          policy_axes: Json
          short_description: string
          specialization_affinity: string[]
          tradition_goal: Json | null
        }
        Insert: {
          created_at?: string
          emoji: string
          goal_weighting?: Json
          key: string
          label: string
          long_description: string
          member_alignment_bonus?: Json
          national_affinity?: string[]
          policy_axes: Json
          short_description: string
          specialization_affinity?: string[]
          tradition_goal?: Json | null
        }
        Update: {
          created_at?: string
          emoji?: string
          goal_weighting?: Json
          key?: string
          label?: string
          long_description?: string
          member_alignment_bonus?: Json
          national_affinity?: string[]
          policy_axes?: Json
          short_description?: string
          specialization_affinity?: string[]
          tradition_goal?: Json | null
        }
        Relationships: []
      }
      team_facilities: {
        Row: {
          id: string
          purchased_season: number | null
          team_id: string
          tier: number
          track: string
          updated_at: string
        }
        Insert: {
          id?: string
          purchased_season?: number | null
          team_id: string
          tier?: number
          track: string
          updated_at?: string
        }
        Update: {
          id?: string
          purchased_season?: number | null
          team_id?: string
          tier?: number
          track?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_facilities_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_facilities_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_global_rank_points: {
        Row: {
          banked_points: number
          team_id: string
          updated_at: string
        }
        Insert: {
          banked_points?: number
          team_id: string
          updated_at?: string
        }
        Update: {
          banked_points?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_global_rank_points_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_global_rank_points_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_race_strategy: {
        Row: {
          a_chain: Json
          captain_priorities: Json
          target_race_ids: Json
          team_id: string
          updated_at: string
        }
        Insert: {
          a_chain?: Json
          captain_priorities?: Json
          target_race_ids?: Json
          team_id: string
          updated_at?: string
        }
        Update: {
          a_chain?: Json
          captain_priorities?: Json
          target_race_ids?: Json
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_race_strategy_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_race_strategy_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_rider_role_rules: {
        Row: {
          rider_id: string
          role_rule: string
          team_id: string
        }
        Insert: {
          rider_id: string
          role_rule: string
          team_id: string
        }
        Update: {
          rider_id?: string
          role_rule?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_rider_role_rules_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_rider_role_rules_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_rider_role_rules_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_staff: {
        Row: {
          created_at: string
          fired_season: number | null
          hired_season: number
          id: string
          name: string
          role: string
          salary: number
          slot: number
          status: string
          team_id: string
          tier: number
        }
        Insert: {
          created_at?: string
          fired_season?: number | null
          hired_season: number
          id?: string
          name: string
          role: string
          salary: number
          slot?: number
          status?: string
          team_id: string
          tier: number
        }
        Update: {
          created_at?: string
          fired_season?: number | null
          hired_season?: number
          id?: string
          name?: string
          role?: string
          salary?: number
          slot?: number
          status?: string
          team_id?: string
          tier?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_staff_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_staff_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          academy_intake_seeded_at: string | null
          ai_source_id: number | null
          balance: number | null
          consecutive_low_satisfaction_expirations: number
          created_at: string | null
          debt_breach_streak: number
          dev_transition_dismissed_at: string | null
          division: number | null
          emergency_loan_streak: number
          id: string
          is_ai: boolean | null
          is_bank: boolean | null
          is_frozen: boolean | null
          is_test_account: boolean
          league_division_id: number | null
          manager_name: string | null
          my_result_seen_race_id: string | null
          name: string
          onboarding_progress_dismissed_at: string | null
          pending_removal_at: string | null
          season_1_identity_basis: Json | null
          sponsor_income: number | null
          starter_depth_topped_up_at: string | null
          starter_squad_allocated_at: string | null
          team_dna_chosen_at: string | null
          team_dna_key: string | null
          transfer_frozen: boolean
          user_id: string | null
        }
        Insert: {
          academy_intake_seeded_at?: string | null
          ai_source_id?: number | null
          balance?: number | null
          consecutive_low_satisfaction_expirations?: number
          created_at?: string | null
          debt_breach_streak?: number
          dev_transition_dismissed_at?: string | null
          division?: number | null
          emergency_loan_streak?: number
          id?: string
          is_ai?: boolean | null
          is_bank?: boolean | null
          is_frozen?: boolean | null
          is_test_account?: boolean
          league_division_id?: number | null
          manager_name?: string | null
          my_result_seen_race_id?: string | null
          name: string
          onboarding_progress_dismissed_at?: string | null
          pending_removal_at?: string | null
          season_1_identity_basis?: Json | null
          sponsor_income?: number | null
          starter_depth_topped_up_at?: string | null
          starter_squad_allocated_at?: string | null
          team_dna_chosen_at?: string | null
          team_dna_key?: string | null
          transfer_frozen?: boolean
          user_id?: string | null
        }
        Update: {
          academy_intake_seeded_at?: string | null
          ai_source_id?: number | null
          balance?: number | null
          consecutive_low_satisfaction_expirations?: number
          created_at?: string | null
          debt_breach_streak?: number
          dev_transition_dismissed_at?: string | null
          division?: number | null
          emergency_loan_streak?: number
          id?: string
          is_ai?: boolean | null
          is_bank?: boolean | null
          is_frozen?: boolean | null
          is_test_account?: boolean
          league_division_id?: number | null
          manager_name?: string | null
          my_result_seen_race_id?: string | null
          name?: string
          onboarding_progress_dismissed_at?: string | null
          pending_removal_at?: string | null
          season_1_identity_basis?: Json | null
          sponsor_income?: number | null
          starter_depth_topped_up_at?: string | null
          starter_squad_allocated_at?: string | null
          team_dna_chosen_at?: string | null
          team_dna_key?: string | null
          transfer_frozen?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_league_division_id_fkey"
            columns: ["league_division_id"]
            isOneToOne: false
            referencedRelation: "league_divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_my_result_seen_race_id_fkey"
            columns: ["my_result_seen_race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_team_dna_key_fkey"
            columns: ["team_dna_key"]
            isOneToOne: false
            referencedRelation: "team_dna"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "teams_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_events: {
        Row: {
          device: string | null
          event: string
          id: number
          is_bot: boolean
          occurred_at: string
          path: string | null
          visit_hash: string
        }
        Insert: {
          device?: string | null
          event: string
          id?: never
          is_bot?: boolean
          occurred_at?: string
          path?: string | null
          visit_hash: string
        }
        Update: {
          device?: string | null
          event?: string
          id?: never
          is_bot?: boolean
          occurred_at?: string
          path?: string | null
          visit_hash?: string
        }
        Relationships: []
      }
      training_day_runs: {
        Row: {
          bonus_applied: boolean
          created_at: string
          executed_by: string
          id: string
          report: Json
          team_id: string
          tick_date: string
        }
        Insert: {
          bonus_applied?: boolean
          created_at?: string
          executed_by: string
          id?: string
          report: Json
          team_id: string
          tick_date: string
        }
        Update: {
          bonus_applied?: boolean
          created_at?: string
          executed_by?: string
          id?: string
          report?: Json
          team_id?: string
          tick_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_day_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "training_day_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      training_plans: {
        Row: {
          created_at: string
          focus: string
          id: string
          intensity: string
          rider_id: string
          season_id: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          focus: string
          id?: string
          intensity: string
          rider_id: string
          season_id: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          focus?: string
          id?: string
          intensity?: string
          rider_id?: string
          season_id?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_plans_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plans_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "ai_active_season_status"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "training_plans_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "training_plans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      training_slot_health_daily: {
        Row: {
          dead_slots: number
          focus: string
          generated_at: string
          partial_slots: number
          riders_in_training: number
          snapshot_date: string
        }
        Insert: {
          dead_slots?: number
          focus: string
          generated_at?: string
          partial_slots?: number
          riders_in_training?: number
          snapshot_date: string
        }
        Update: {
          dead_slots?: number
          focus?: string
          generated_at?: string
          partial_slots?: number
          riders_in_training?: number
          snapshot_date?: string
        }
        Relationships: []
      }
      training_week_plans: {
        Row: {
          created_at: string
          days: Json
          id: string
          rider_id: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          days: Json
          id?: string
          rider_id?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          days?: Json
          id?: string
          rider_id?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_week_plans_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_week_plans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "training_week_plans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
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
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
          board_negotiation_state: string
          board_test_mode: boolean
          closed_at: string | null
          closes_at: string | null
          created_at: string | null
          final_whistle_sent_at: string | null
          id: string
          opened_at: string | null
          season_id: string | null
          squad_enforcement_completed_at: string | null
          squad_enforcement_started_at: string | null
          status: string | null
        }
        Insert: {
          board_negotiation_state?: string
          board_test_mode?: boolean
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string | null
          final_whistle_sent_at?: string | null
          id?: string
          opened_at?: string | null
          season_id?: string | null
          squad_enforcement_completed_at?: string | null
          squad_enforcement_started_at?: string | null
          status?: string | null
        }
        Update: {
          board_negotiation_state?: string
          board_test_mode?: boolean
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string | null
          final_whistle_sent_at?: string | null
          id?: string
          opened_at?: string | null
          season_id?: string | null
          squad_enforcement_completed_at?: string | null
          squad_enforcement_started_at?: string | null
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
          consent_preferences: Json | null
          created_at: string | null
          discord_disconnected_at: string | null
          discord_dm_enabled: boolean
          discord_dm_failure_count: number
          discord_dm_prefs: Json
          discord_id: string | null
          email: string
          email_prefs: Json
          id: string
          is_beta_tester: boolean
          language: string
          last_login_date: string | null
          last_seen: string | null
          level: number | null
          login_streak: number | null
          nps_last_prompted_at: string | null
          role: string
          username: string
          xp: number | null
        }
        Insert: {
          consent_preferences?: Json | null
          created_at?: string | null
          discord_disconnected_at?: string | null
          discord_dm_enabled?: boolean
          discord_dm_failure_count?: number
          discord_dm_prefs?: Json
          discord_id?: string | null
          email: string
          email_prefs?: Json
          id?: string
          is_beta_tester?: boolean
          language?: string
          last_login_date?: string | null
          last_seen?: string | null
          level?: number | null
          login_streak?: number | null
          nps_last_prompted_at?: string | null
          role?: string
          username: string
          xp?: number | null
        }
        Update: {
          consent_preferences?: Json | null
          created_at?: string | null
          discord_disconnected_at?: string | null
          discord_dm_enabled?: boolean
          discord_dm_failure_count?: number
          discord_dm_prefs?: Json
          discord_id?: string | null
          email?: string
          email_prefs?: Json
          id?: string
          is_beta_tester?: boolean
          language?: string
          last_login_date?: string | null
          last_seen?: string | null
          level?: number | null
          login_streak?: number | null
          nps_last_prompted_at?: string | null
          role?: string
          username?: string
          xp?: number | null
        }
        Relationships: []
      }
      value_transition_preview: {
        Row: {
          computed_at: string
          cpv_damped: number | null
          cpv_now: number | null
          is_academy: boolean
          primary_type: string | null
          rider_id: string
          salary_expected: number | null
          salary_expected_no_damp: number | null
          salary_now: number | null
          team_id: string | null
          valuation_type: string | null
          value_damped: number | null
          value_now: number
        }
        Insert: {
          computed_at?: string
          cpv_damped?: number | null
          cpv_now?: number | null
          is_academy?: boolean
          primary_type?: string | null
          rider_id: string
          salary_expected?: number | null
          salary_expected_no_damp?: number | null
          salary_now?: number | null
          team_id?: string | null
          valuation_type?: string | null
          value_damped?: number | null
          value_now: number
        }
        Update: {
          computed_at?: string
          cpv_damped?: number | null
          cpv_now?: number | null
          is_academy?: boolean
          primary_type?: string | null
          rider_id?: string
          salary_expected?: number | null
          salary_expected_no_damp?: number | null
          salary_now?: number | null
          team_id?: string | null
          valuation_type?: string | null
          value_damped?: number | null
          value_now?: number
        }
        Relationships: [
          {
            foreignKeyName: "value_transition_preview_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: true
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      wage_daily_runs: {
        Row: {
          amount: number
          created_at: string
          id: string
          riders_charged: number
          team_id: string
          tick_date: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          riders_charged?: number
          team_id: string
          tick_date: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          riders_charged?: number
          team_id?: string
          tick_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "wage_daily_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "wage_daily_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
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
        Insert: {
          prize_transaction_count?: never
          race_count?: never
          race_days_completed?: number | null
          race_days_total?: number | null
          race_result_count?: never
          season_id?: string | null
          season_number?: number | null
          standings_count?: never
          status?: string | null
        }
        Update: {
          prize_transaction_count?: never
          race_count?: never
          race_days_completed?: number | null
          race_days_total?: number | null
          race_result_count?: never
          season_id?: string | null
          season_number?: number | null
          standings_count?: never
          status?: string | null
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
      global_rank_mv: {
        Row: {
          active_recent: boolean | null
          banked_points: number | null
          division: number | null
          global_points: number | null
          global_rank: number | null
          is_ai: boolean | null
          is_rookie: boolean | null
          name: string | null
          season_points: number | null
          team_id: string | null
        }
        Relationships: []
      }
      rider_rankings_mv: {
        Row: {
          classic_wins: number | null
          gc_wins: number | null
          green_days: number | null
          mtn_wins: number | null
          points: number | null
          polka_days: number | null
          prize_earned: number | null
          pts_wins: number | null
          rider_id: string | null
          season_id: string | null
          stage_wins: number | null
          top10: number | null
          top3: number | null
          white_days: number | null
          yellow_days: number | null
          young_wins: number | null
        }
        Relationships: [
          {
            foreignKeyName: "race_results_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
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
      roadmap_item_scores: {
        Row: {
          approved: boolean | null
          avg_idea: number | null
          avg_importance: number | null
          engine: string | null
          item_id: string | null
          status: string | null
          steering_score: number | null
          title_en: string | null
          votes: number | null
        }
        Relationships: []
      }
      team_race_points_mv: {
        Row: {
          race_id: string | null
          race_name: string | null
          race_points: number | null
          season_id: string | null
          team_id: string | null
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
          {
            foreignKeyName: "riders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "global_rank_mv"
            referencedColumns: ["team_id"]
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
      team_standings_ext_mv: {
        Row: {
          comp_podiums: number | null
          comp_wins: number | null
          podiums: number | null
          prize_earned: number | null
          season_id: string | null
          team_id: string | null
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
    }
    Functions: {
      apply_global_rank_season_rollover: {
        Args: { p_completed_season_id: string }
        Returns: undefined
      }
      apply_race_entry_unit_batch: {
        Args: { p_team_id: string; p_units: Json }
        Returns: Json
      }
      apply_race_results_batch: {
        Args: {
          p_race_id: string
          p_result_rows: Json
          p_stage_numbers: number[]
        }
        Returns: Json
      }
      apply_rider_development: {
        Args: {
          p_ability_patch: Json
          p_log: Json
          p_rider_id: string
          p_rider_patch: Json
          p_season_id: string
          p_season_number: number
        }
        Returns: boolean
      }
      apply_stage_result: {
        Args: {
          p_race_id: string
          p_result_rows: Json
          p_stage_index: number
          p_stage_number: number
          p_total_stages: number
        }
        Returns: Json
      }
      audit_default_privileges: {
        Args: never
        Returns: {
          grantee_role: string
          grantor_role: string
          privilege_type: string
          schema_name: string
        }[]
      }
      audit_foreign_keys: {
        Args: never
        Returns: {
          child_column: string
          child_table: string
          constraint_name: string
          delete_action: string
          parent_column: string
          parent_table: string
        }[]
      }
      audit_rls_coverage: {
        Args: never
        Returns: {
          has_authenticated_select: boolean
          policy_count: number
          policy_names: string[]
          rls_enabled: boolean
          select_policy_count: number
          table_name: string
        }[]
      }
      audit_write_grants: {
        Args: never
        Returns: {
          anon_delete: boolean
          anon_insert: boolean
          anon_truncate: boolean
          anon_update: boolean
          authenticated_delete: boolean
          authenticated_insert: boolean
          authenticated_truncate: boolean
          authenticated_update: boolean
          delete_policy_covers_client: boolean
          insert_policy_covers_client: boolean
          is_view: boolean
          relkind: string
          rls_enabled: boolean
          table_name: string
          update_policy_covers_client: boolean
          view_is_insertable: boolean
          view_is_updatable: boolean
          write_policy_names: string[]
        }[]
      }
      compute_daily_growth_snapshot: {
        Args: { p_snapshot_date?: string }
        Returns: Json
      }
      create_emergency_loan_atomic: {
        Args: {
          p_amount_needed: number
          p_debt_ceiling: number
          p_interest_rate: number
          p_origination_fee_pct: number
          p_season_id?: string
          p_team_id: string
        }
        Returns: {
          accrued_interest: number
          amount_remaining: number
          created_at: string | null
          id: string
          interest_rate: number
          last_interest_season_id: string | null
          loan_type: string
          origination_fee: number
          principal: number
          season_id: string | null
          seasons_remaining: number
          seasons_total: number
          status: string
          team_id: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_loan_atomic: {
        Args: {
          p_debt_ceiling: number
          p_interest_rate: number
          p_loan_type: string
          p_origination_fee: number
          p_principal: number
          p_seasons: number
          p_team_id: string
        }
        Returns: {
          accrued_interest: number
          amount_remaining: number
          created_at: string | null
          id: string
          interest_rate: number
          last_interest_season_id: string | null
          loan_type: string
          origination_fee: number
          principal: number
          season_id: string | null
          seasons_remaining: number
          seasons_total: number
          status: string
          team_id: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dashboard_my_team_season_races: {
        Args: {
          p_league_division_id: number
          p_limit: number
          p_season_id: string
          p_team_id: string
        }
        Returns: {
          best_rank: number
          last_import: string
          points: number
          prize_money: number
          race_id: string
          race_name: string
          race_type: string
          season_points: number
          season_prize_money: number
          season_races: number
          stages: number
        }[]
      }
      dashboard_rider_ranking: {
        Args: { p_league_division_id: number; p_season_id: string }
        Returns: {
          firstname: string
          gc_wins: number
          is_ai: boolean
          lastname: string
          nationality_code: string
          points: number
          rider_id: string
          stage_wins: number
          team_name: string
        }[]
      }
      demote_rider_to_academy: {
        Args: {
          p_contract_end: number
          p_contract_length: number
          p_new_salary: number
          p_rider_id: string
          p_season_start_year: number
          p_team_id: string
        }
        Returns: Json
      }
      feature_liveness_applied_migrations: {
        Args: never
        Returns: {
          applied_at: string
          filename: string
        }[]
      }
      feature_liveness_event_counts: {
        Args: { window_days?: number }
        Returns: {
          event_count: number
          event_name: string
          last_seen: string
        }[]
      }
      feature_liveness_prod_tables: {
        Args: never
        Returns: {
          table_name: string
        }[]
      }
      feature_liveness_table_counts: {
        Args: never
        Returns: {
          rls_enabled: boolean
          row_count: number
          table_name: string
        }[]
      }
      finalize_academy_acquisition: {
        Args: {
          p_acquired_at: string
          p_contract_end_season: number
          p_contract_length: number
          p_finance_payload: Json
          p_price: number
          p_rider_id: string
          p_salary: number
          p_team_id: string
        }
        Returns: Json
      }
      get_cohort_retention: { Args: { p_weeks?: number }; Returns: Json }
      get_retention_scorecard_activity: {
        Args: { p_weeks?: number }
        Returns: {
          last_activity: string
          signup_at: string
          user_id: string
        }[]
      }
      get_rider_race_days: {
        Args: { p_rider_ids: string[]; p_season_id: string }
        Returns: {
          race_days: number
          rider_id: string
        }[]
      }
      get_season_documentary_facts: {
        Args: { p_season_id: string; p_team_id: string }
        Returns: Json
      }
      get_season_honours: { Args: { p_season_id: string }; Returns: Json }
      get_season_recap: { Args: { p_season_id: string }; Returns: Json }
      get_sprint_metrics: { Args: { p_window?: string }; Returns: Json }
      increment_balance_with_audit: {
        Args: { p_delta: number; p_finance_payload: Json; p_team_id: string }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_beta_tester: { Args: never; Returns: boolean }
      is_offered_intake_rider: {
        Args: { p_rider_id: string }
        Returns: boolean
      }
      move_race_entry: {
        Args: {
          p_from_race_id: string
          p_max: number
          p_rider_id: string
          p_team_id: string
          p_to_race_id: string
        }
        Returns: undefined
      }
      race_entries_binding_span: {
        Args: { p_race_id: string; p_team_id: string }
        Returns: unknown
      }
      race_entry_days_rebuild: {
        Args: { p_race_id: string; p_team_id: string }
        Returns: undefined
      }
      recompute_season_standings: {
        Args: { p_season_id: string }
        Returns: Json
      }
      refresh_global_rank_mv: { Args: never; Returns: undefined }
      refresh_ranking_matviews: { Args: never; Returns: undefined }
      refresh_rider_rankings_mv: { Args: never; Returns: undefined }
      refresh_team_race_points_mv: { Args: never; Returns: undefined }
      refresh_team_standings_ext_mv: { Args: never; Returns: undefined }
      regenerate_race_points: { Args: never; Returns: number }
      repay_loan_atomic: {
        Args: {
          p_amount: number
          p_finance_payload: Json
          p_loan_id: string
          p_team_id: string
        }
        Returns: Json
      }
      replace_race_selection: {
        Args: {
          p_race_id: string
          p_rider_ids: string[]
          p_roles: string[]
          p_team_id: string
        }
        Returns: undefined
      }
      submit_race_results: {
        Args: { p_race_id: string; p_rows: Json }
        Returns: string
      }
      take_global_rank_weekly_snapshot: { Args: never; Returns: undefined }
      touch_user_presence: { Args: { p_user_id: string }; Returns: undefined }
      traffic_visit_rollup: {
        Args: { since_ts: string }
        Returns: {
          engaged_events: number
          is_bot: boolean
          pageviews: number
          visit_hash: string
        }[]
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
