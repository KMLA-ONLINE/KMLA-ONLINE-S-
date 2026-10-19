export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_contacts: {
        Row: {
          kind: string
          label: string
          position: number
          value: string
        }
        ComputedFields: never
        Insert: {
          kind: string
          label: string
          position: number
          value: string
        }
        Update: {
          kind?: string
          label?: string
          position?: number
          value?: string
        }
        Relationships: []
      }
      comment_images: {
        Row: {
          comment_id: string | null
          created_at: string
          deleted_at: string | null
          finalized_at: string | null
          height: number
          id: string
          mime_type: string
          object_path: string
          post_id: string
          ready_at: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["comment_image_status"]
          storage_bucket: string
          width: number
        }
        ComputedFields: never
        Insert: {
          comment_id?: string | null
          created_at?: string
          deleted_at?: string | null
          finalized_at?: string | null
          height: number
          id?: string
          mime_type: string
          object_path: string
          post_id: string
          ready_at?: string | null
          size_bytes: number
          status?: Database["public"]["Enums"]["comment_image_status"]
          storage_bucket?: string
          width: number
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          deleted_at?: string | null
          finalized_at?: string | null
          height?: number
          id?: string
          mime_type?: string
          object_path?: string
          post_id?: string
          ready_at?: string | null
          size_bytes?: number
          status?: Database["public"]["Enums"]["comment_image_status"]
          storage_bucket?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "comment_images_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_images_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_mentions: {
        Row: {
          comment_id: string
          ordinal: number
          profile_id: number
        }
        ComputedFields: never
        Insert: {
          comment_id: string
          ordinal: number
          profile_id: number
        }
        Update: {
          comment_id?: string
          ordinal?: number
          profile_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "comment_mentions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_mentions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          profile_id: number
          reaction: Database["public"]["Enums"]["post_reaction"]
        }
        ComputedFields: never
        Insert: {
          comment_id: string
          created_at?: string
          profile_id: number
          reaction: Database["public"]["Enums"]["post_reaction"]
        }
        Update: {
          comment_id?: string
          created_at?: string
          profile_id?: number
          reaction?: Database["public"]["Enums"]["post_reaction"]
        }
        Relationships: [
          {
            foreignKeyName: "comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          hidden_at: string | null
          id: number
          joined_at: string
          last_read_message_id: string
          last_read_sent_at: string
          left_at: string | null
          left_by_self: boolean
          mentions_only: boolean
          muted_until: string | null
          profile_id: number
        }
        ComputedFields: never
        Insert: {
          conversation_id: string
          hidden_at?: string | null
          id?: number
          joined_at?: string
          last_read_message_id?: string
          last_read_sent_at?: string
          left_at?: string | null
          left_by_self?: boolean
          mentions_only?: boolean
          muted_until?: string | null
          profile_id: number
        }
        Update: {
          conversation_id?: string
          hidden_at?: string | null
          id?: number
          joined_at?: string
          last_read_message_id?: string
          last_read_sent_at?: string
          left_at?: string | null
          left_by_self?: boolean
          mentions_only?: boolean
          muted_until?: string | null
          profile_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: number | null
          direct_profile_high: number | null
          direct_profile_low: number | null
          id: string
          name: string | null
          type: Database["public"]["Enums"]["conversation_type"]
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: number | null
          direct_profile_high?: number | null
          direct_profile_low?: number | null
          id?: string
          name?: string | null
          type: Database["public"]["Enums"]["conversation_type"]
        }
        Update: {
          created_at?: string
          created_by?: number | null
          direct_profile_high?: number | null
          direct_profile_low?: number | null
          id?: string
          name?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_direct_profile_high_fkey"
            columns: ["direct_profile_high"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_direct_profile_low_fkey"
            columns: ["direct_profile_low"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      donation_claims: {
        Row: {
          cancelled_at: string | null
          created_at: string
          id: number
          item_id: number
          profile_id: number | null
        }
        ComputedFields: never
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          id?: never
          item_id: number
          profile_id?: number | null
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          id?: never
          item_id?: number
          profile_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "donation_claims_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "donation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donation_claims_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      donation_items: {
        Row: {
          category: string
          detail: string | null
          donor_name: string | null
          id: number
          name: string
          round_id: number
          source_row: number
          source_sheet: string
        }
        ComputedFields: never
        Insert: {
          category: string
          detail?: string | null
          donor_name?: string | null
          id?: never
          name: string
          round_id: number
          source_row: number
          source_sheet: string
        }
        Update: {
          category?: string
          detail?: string | null
          donor_name?: string | null
          id?: never
          name?: string
          round_id?: number
          source_row?: number
          source_sheet?: string
        }
        Relationships: [
          {
            foreignKeyName: "donation_items_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "donation_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      donation_rounds: {
        Row: {
          closes_at: string
          created_at: string
          id: number
          opens_at: string
          title: string
        }
        ComputedFields: never
        Insert: {
          closes_at: string
          created_at?: string
          id?: never
          opens_at: string
          title: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          id?: never
          opens_at?: string
          title?: string
        }
        Relationships: []
      }
      gongang_schedule: {
        Row: {
          configured_by: number | null
          created_at: string
          detail: string | null
          location: string
          recurring: boolean
          recurring_until: string | null
          reserved: boolean
          schedule_date: string
          slot: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          configured_by?: number | null
          created_at?: string
          detail?: string | null
          location: string
          recurring?: boolean
          recurring_until?: string | null
          reserved?: boolean
          schedule_date: string
          slot: string
          updated_at?: string
        }
        Update: {
          configured_by?: number | null
          created_at?: string
          detail?: string | null
          location?: string
          recurring?: boolean
          recurring_until?: string | null
          reserved?: boolean
          schedule_date?: string
          slot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gongang_schedule_configured_by_fkey"
            columns: ["configured_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_categories: {
        Row: {
          created_at: string
          group_id: string
          id: string
          name: string
          position: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          name: string
          position: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_categories_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_join_requests: {
        Row: {
          group_id: string
          id: string
          profile_id: number
          requested_at: string
        }
        ComputedFields: never
        Insert: {
          group_id: string
          id?: string
          profile_id: number
          requested_at?: string
        }
        Update: {
          group_id?: string
          id?: string
          profile_id?: number
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_join_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_join_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_media_objects: {
        Row: {
          created_at: string
          deleted_at: string | null
          group_id: string
          height: number
          id: string
          object_path: string
          ready_at: string | null
          size_bytes: number
          slot: Database["public"]["Enums"]["group_media_slot"]
          status: Database["public"]["Enums"]["group_media_status"]
          width: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          group_id: string
          height: number
          id?: string
          object_path: string
          ready_at?: string | null
          size_bytes: number
          slot: Database["public"]["Enums"]["group_media_slot"]
          status?: Database["public"]["Enums"]["group_media_status"]
          width: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          group_id?: string
          height?: number
          id?: string
          object_path?: string
          ready_at?: string | null
          size_bytes?: number
          slot?: Database["public"]["Enums"]["group_media_slot"]
          status?: Database["public"]["Enums"]["group_media_status"]
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_media_objects_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_memberships: {
        Row: {
          content_push_enabled: boolean
          group_id: string
          id: string
          joined_at: string
          new_post_push_enabled: boolean
          notification_level: Database["public"]["Enums"]["group_notification_level"]
          pinned_at: string | null
          posts_visited_at: string
          profile_id: number
          role: Database["public"]["Enums"]["group_member_role"]
        }
        ComputedFields: never
        Insert: {
          content_push_enabled?: boolean
          group_id: string
          id?: string
          joined_at?: string
          new_post_push_enabled?: boolean
          notification_level?: Database["public"]["Enums"]["group_notification_level"]
          pinned_at?: string | null
          posts_visited_at?: string
          profile_id: number
          role?: Database["public"]["Enums"]["group_member_role"]
        }
        Update: {
          content_push_enabled?: boolean
          group_id?: string
          id?: string
          joined_at?: string
          new_post_push_enabled?: boolean
          notification_level?: Database["public"]["Enums"]["group_notification_level"]
          pinned_at?: string | null
          posts_visited_at?: string
          profile_id?: number
          role?: Database["public"]["Enums"]["group_member_role"]
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          cover_path: string | null
          created_at: string
          created_by: number
          description: string
          hide_staff_roles: boolean
          icon_path: string | null
          id: string
          identity_policy: Database["public"]["Enums"]["group_identity_policy"]
          join_policy: Database["public"]["Enums"]["group_join_policy"]
          kind: Database["public"]["Enums"]["group_kind"]
          member_count: number
          name: string
          posting_policy: Database["public"]["Enums"]["group_posting_policy"]
          search_name: string | null
          slug: string
          slug_is_custom: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          cover_path?: string | null
          created_at?: string
          created_by: number
          description?: string
          hide_staff_roles?: boolean
          icon_path?: string | null
          id?: string
          identity_policy: Database["public"]["Enums"]["group_identity_policy"]
          join_policy: Database["public"]["Enums"]["group_join_policy"]
          kind: Database["public"]["Enums"]["group_kind"]
          member_count?: number
          name: string
          posting_policy: Database["public"]["Enums"]["group_posting_policy"]
          search_name?: never
          slug: string
          slug_is_custom?: boolean
          updated_at?: string
        }
        Update: {
          cover_path?: string | null
          created_at?: string
          created_by?: number
          description?: string
          hide_staff_roles?: boolean
          icon_path?: string | null
          id?: string
          identity_policy?: Database["public"]["Enums"]["group_identity_policy"]
          join_policy?: Database["public"]["Enums"]["group_join_policy"]
          kind?: Database["public"]["Enums"]["group_kind"]
          member_count?: number
          name?: string
          posting_policy?: Database["public"]["Enums"]["group_posting_policy"]
          search_name?: never
          slug?: string
          slug_is_custom?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          account_push_enabled: boolean
          content_push_enabled: boolean
          group_push_enabled: boolean
          message_preview_hidden: boolean
          profile_id: number
          school_push_enabled: boolean
          timeline_push_enabled: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          account_push_enabled?: boolean
          content_push_enabled?: boolean
          group_push_enabled?: boolean
          message_preview_hidden?: boolean
          profile_id: number
          school_push_enabled?: boolean
          timeline_push_enabled?: boolean
          updated_at?: string
        }
        Update: {
          account_push_enabled?: boolean
          content_push_enabled?: boolean
          group_push_enabled?: boolean
          message_preview_hidden?: boolean
          profile_id?: number
          school_push_enabled?: boolean
          timeline_push_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_avatar_path: string | null
          actor_count: number
          actor_display_name: string | null
          actor_identity: Database["public"]["Enums"]["notification_actor_identity"]
          actor_profile_id: number | null
          category: Database["public"]["Enums"]["notification_category"]
          comment_id: string | null
          created_at: string
          detail: string | null
          group_id: string | null
          id: string
          importance: Database["public"]["Enums"]["notification_importance"]
          kind: Database["public"]["Enums"]["notification_kind"]
          last_activity_at: string
          post_id: string | null
          read_at: string | null
          recipient_profile_id: number
          reservation_id: number | null
          restriction_expires_at: string | null
          target_profile_id: number | null
          title: string
        }
        ComputedFields: never
        Insert: {
          actor_avatar_path?: string | null
          actor_count?: number
          actor_display_name?: string | null
          actor_identity: Database["public"]["Enums"]["notification_actor_identity"]
          actor_profile_id?: number | null
          category: Database["public"]["Enums"]["notification_category"]
          comment_id?: string | null
          created_at?: string
          detail?: string | null
          group_id?: string | null
          id?: string
          importance: Database["public"]["Enums"]["notification_importance"]
          kind: Database["public"]["Enums"]["notification_kind"]
          last_activity_at?: string
          post_id?: string | null
          read_at?: string | null
          recipient_profile_id: number
          reservation_id?: number | null
          restriction_expires_at?: string | null
          target_profile_id?: number | null
          title: string
        }
        Update: {
          actor_avatar_path?: string | null
          actor_count?: number
          actor_display_name?: string | null
          actor_identity?: Database["public"]["Enums"]["notification_actor_identity"]
          actor_profile_id?: number | null
          category?: Database["public"]["Enums"]["notification_category"]
          comment_id?: string | null
          created_at?: string
          detail?: string | null
          group_id?: string | null
          id?: string
          importance?: Database["public"]["Enums"]["notification_importance"]
          kind?: Database["public"]["Enums"]["notification_kind"]
          last_activity_at?: string
          post_id?: string | null
          read_at?: string | null
          recipient_profile_id?: number
          reservation_id?: number | null
          restriction_expires_at?: string | null
          target_profile_id?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "utility_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_target_profile_id_fkey"
            columns: ["target_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          key: string
          name: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          name?: string
        }
        Relationships: []
      }
      post_attachments: {
        Row: {
          created_at: string
          deleted_at: string | null
          height: number | null
          id: string
          mime_type: string
          object_path: string
          original_filename: string
          position: number
          post_id: string
          ready_at: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["post_attachment_status"]
          storage_bucket: string
          thumbnail_path: string | null
          width: number | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          height?: number | null
          id?: string
          mime_type: string
          object_path: string
          original_filename: string
          position: number
          post_id: string
          ready_at?: string | null
          size_bytes: number
          status?: Database["public"]["Enums"]["post_attachment_status"]
          storage_bucket?: string
          thumbnail_path?: string | null
          width?: number | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          height?: number | null
          id?: string
          mime_type?: string
          object_path?: string
          original_filename?: string
          position?: number
          post_id?: string
          ready_at?: string | null
          size_bytes?: number
          status?: Database["public"]["Enums"]["post_attachment_status"]
          storage_bucket?: string
          thumbnail_path?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_attachments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          anon_alias_number: number | null
          author_identity: Database["public"]["Enums"]["post_identity"]
          body: string
          created_at: string
          deleted_at: string | null
          depth: number
          display_author_profile_id: number | null
          edited_at: string | null
          id: string
          parent_comment_id: string | null
          post_id: string
          root_comment_id: string
        }
        ComputedFields: never
        Insert: {
          anon_alias_number?: number | null
          author_identity: Database["public"]["Enums"]["post_identity"]
          body: string
          created_at?: string
          deleted_at?: string | null
          depth?: number
          display_author_profile_id?: number | null
          edited_at?: string | null
          id?: string
          parent_comment_id?: string | null
          post_id: string
          root_comment_id: string
        }
        Update: {
          anon_alias_number?: number | null
          author_identity?: Database["public"]["Enums"]["post_identity"]
          body?: string
          created_at?: string
          deleted_at?: string | null
          depth?: number
          display_author_profile_id?: number | null
          edited_at?: string | null
          id?: string
          parent_comment_id?: string | null
          post_id?: string
          root_comment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_display_author_profile_id_fkey"
            columns: ["display_author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_mentions: {
        Row: {
          ordinal: number
          post_id: string
          profile_id: number
        }
        ComputedFields: never
        Insert: {
          ordinal: number
          post_id: string
          profile_id: number
        }
        Update: {
          ordinal?: number
          post_id?: string
          profile_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_mentions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_mentions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          post_id: string
          profile_id: number
          reaction: Database["public"]["Enums"]["post_reaction"]
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          post_id: string
          profile_id: number
          reaction: Database["public"]["Enums"]["post_reaction"]
        }
        Update: {
          created_at?: string
          post_id?: string
          profile_id?: number
          reaction?: Database["public"]["Enums"]["post_reaction"]
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          activity_kind:
            Database["public"]["Enums"]["profile_media_activity_kind"] | null
          activity_media_path: string | null
          author_identity: Database["public"]["Enums"]["post_identity"]
          body: string
          body_format_version: number
          category_id: string | null
          comment_count: number
          created_at: string
          display_author_profile_id: number | null
          edited_at: string | null
          group_id: string | null
          id: string
          kind: Database["public"]["Enums"]["post_kind"]
          pinned_at: string | null
          published_at: string | null
          search_text: string | null
          timeline_profile_id: number | null
          title: string | null
          visibility: Database["public"]["Enums"]["post_visibility"] | null
        }
        ComputedFields: never
        Insert: {
          activity_kind?:
            Database["public"]["Enums"]["profile_media_activity_kind"] | null
          activity_media_path?: string | null
          author_identity: Database["public"]["Enums"]["post_identity"]
          body?: string
          body_format_version?: number
          category_id?: string | null
          comment_count?: number
          created_at?: string
          display_author_profile_id?: number | null
          edited_at?: string | null
          group_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["post_kind"]
          pinned_at?: string | null
          published_at?: string | null
          search_text?: never
          timeline_profile_id?: number | null
          title?: string | null
          visibility?: Database["public"]["Enums"]["post_visibility"] | null
        }
        Update: {
          activity_kind?:
            Database["public"]["Enums"]["profile_media_activity_kind"] | null
          activity_media_path?: string | null
          author_identity?: Database["public"]["Enums"]["post_identity"]
          body?: string
          body_format_version?: number
          category_id?: string | null
          comment_count?: number
          created_at?: string
          display_author_profile_id?: number | null
          edited_at?: string | null
          group_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["post_kind"]
          pinned_at?: string | null
          published_at?: string | null
          search_text?: never
          timeline_profile_id?: number | null
          title?: string | null
          visibility?: Database["public"]["Enums"]["post_visibility"] | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_category_group_fkey"
            columns: ["category_id", "group_id"]
            isOneToOne: false
            referencedRelation: "group_categories"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "posts_display_author_profile_id_fkey"
            columns: ["display_author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_timeline_profile_id_fkey"
            columns: ["timeline_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_departments: {
        Row: {
          is_active: boolean
          name: string
          sort_order: number
        }
        ComputedFields: never
        Insert: {
          is_active?: boolean
          name: string
          sort_order: number
        }
        Update: {
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      profile_media_activity_objects: {
        Row: {
          auth_user_id: string
          created_at: string
          height: number
          id: string
          object_path: string
          profile_id: number
          ready_at: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["profile_media_status"]
          width: number
        }
        ComputedFields: never
        Insert: {
          auth_user_id: string
          created_at?: string
          height: number
          id?: string
          object_path: string
          profile_id: number
          ready_at?: string | null
          size_bytes: number
          status?: Database["public"]["Enums"]["profile_media_status"]
          width: number
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          height?: number
          id?: string
          object_path?: string
          profile_id?: number
          ready_at?: string | null
          size_bytes?: number
          status?: Database["public"]["Enums"]["profile_media_status"]
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_media_activity_objects_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_media_objects: {
        Row: {
          activity_media_id: string | null
          auth_user_id: string
          created_at: string
          height: number
          id: string
          object_path: string
          profile_id: number
          ready_at: string | null
          size_bytes: number
          slot: Database["public"]["Enums"]["profile_media_slot"]
          status: Database["public"]["Enums"]["profile_media_status"]
          width: number
        }
        ComputedFields: never
        Insert: {
          activity_media_id?: string | null
          auth_user_id: string
          created_at?: string
          height: number
          id?: string
          object_path: string
          profile_id: number
          ready_at?: string | null
          size_bytes: number
          slot: Database["public"]["Enums"]["profile_media_slot"]
          status?: Database["public"]["Enums"]["profile_media_status"]
          width: number
        }
        Update: {
          activity_media_id?: string | null
          auth_user_id?: string
          created_at?: string
          height?: number
          id?: string
          object_path?: string
          profile_id?: number
          ready_at?: string | null
          size_bytes?: number
          slot?: Database["public"]["Enums"]["profile_media_slot"]
          status?: Database["public"]["Enums"]["profile_media_status"]
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_media_objects_activity_media_id_fkey"
            columns: ["activity_media_id"]
            isOneToOne: false
            referencedRelation: "profile_media_activity_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_media_objects_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_permissions: {
        Row: {
          created_at: string
          permission_key: string
          profile_id: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          permission_key: string
          profile_id: number
        }
        Update: {
          created_at?: string
          permission_key?: string
          profile_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "profile_permissions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          academic_track:
            Database["public"]["Enums"]["profile_academic_track"] | null
          allow_timeline_posts: boolean
          anonymous_username: string | null
          auth_user_id: string | null
          avatar_path: string | null
          birthday: string | null
          class_no: number | null
          cohort: number | null
          contact_email: string | null
          cover_path: string | null
          created_at: string
          deleted_at: string | null
          department: string | null
          description: string | null
          dorm_room: number | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          id: number
          is_returning_student: boolean
          name: string
          onboarding_completed_at: string
          phone_number: string | null
          pub_id: string
          role: Database["public"]["Enums"]["app_role"]
          search_name: string | null
          status: Database["public"]["Enums"]["profile_status"]
          status_updated_at: string
          status_updated_by: number | null
          student_number: string | null
          submitted_at: string
          type: Database["public"]["Enums"]["profile_type"]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          academic_track?:
            Database["public"]["Enums"]["profile_academic_track"] | null
          allow_timeline_posts?: boolean
          anonymous_username?: string | null
          auth_user_id?: string | null
          avatar_path?: string | null
          birthday?: string | null
          class_no?: number | null
          cohort?: number | null
          contact_email?: string | null
          cover_path?: string | null
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          description?: string | null
          dorm_room?: number | null
          gender?: Database["public"]["Enums"]["profile_gender"] | null
          id?: never
          is_returning_student?: boolean
          name: string
          onboarding_completed_at?: string
          phone_number?: string | null
          pub_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          search_name?: never
          status?: Database["public"]["Enums"]["profile_status"]
          status_updated_at?: string
          status_updated_by?: number | null
          student_number?: string | null
          submitted_at?: string
          type: Database["public"]["Enums"]["profile_type"]
          updated_at?: string
        }
        Update: {
          academic_track?:
            Database["public"]["Enums"]["profile_academic_track"] | null
          allow_timeline_posts?: boolean
          anonymous_username?: string | null
          auth_user_id?: string | null
          avatar_path?: string | null
          birthday?: string | null
          class_no?: number | null
          cohort?: number | null
          contact_email?: string | null
          cover_path?: string | null
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          description?: string | null
          dorm_room?: number | null
          gender?: Database["public"]["Enums"]["profile_gender"] | null
          id?: never
          is_returning_student?: boolean
          name?: string
          onboarding_completed_at?: string
          phone_number?: string | null
          pub_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          search_name?: never
          status?: Database["public"]["Enums"]["profile_status"]
          status_updated_at?: string
          status_updated_by?: number | null
          student_number?: string | null
          submitted_at?: string
          type?: Database["public"]["Enums"]["profile_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_status_updated_by_fkey"
            columns: ["status_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stories: {
        Row: {
          audience: Database["public"]["Enums"]["story_audience"]
          background: string | null
          content: string
          created_at: string
          expires_at: string | null
          id: number
          image_height: number | null
          image_path: string | null
          image_size_bytes: number | null
          image_width: number | null
          layout: Json | null
          link_url: string | null
          profile_id: number
          published_at: string | null
          status: Database["public"]["Enums"]["story_status"]
          thumbnail_path: string | null
        }
        ComputedFields: never
        Insert: {
          audience?: Database["public"]["Enums"]["story_audience"]
          background?: string | null
          content?: string
          created_at?: string
          expires_at?: string | null
          id?: number
          image_height?: number | null
          image_path?: string | null
          image_size_bytes?: number | null
          image_width?: number | null
          layout?: Json | null
          link_url?: string | null
          profile_id: number
          published_at?: string | null
          status?: Database["public"]["Enums"]["story_status"]
          thumbnail_path?: string | null
        }
        Update: {
          audience?: Database["public"]["Enums"]["story_audience"]
          background?: string | null
          content?: string
          created_at?: string
          expires_at?: string | null
          id?: number
          image_height?: number | null
          image_path?: string | null
          image_size_bytes?: number | null
          image_width?: number | null
          layout?: Json | null
          link_url?: string | null
          profile_id?: number
          published_at?: string | null
          status?: Database["public"]["Enums"]["story_status"]
          thumbnail_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stories_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      story_reactions: {
        Row: {
          created_at: string
          id: number
          profile_id: number
          reaction: Database["public"]["Enums"]["post_reaction"]
          story_id: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: number
          profile_id: number
          reaction: Database["public"]["Enums"]["post_reaction"]
          story_id: number
        }
        Update: {
          created_at?: string
          id?: number
          profile_id?: number
          reaction?: Database["public"]["Enums"]["post_reaction"]
          story_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "story_reactions_story_id_profile_id_fkey"
            columns: ["story_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "story_views"
            referencedColumns: ["story_id", "profile_id"]
          },
        ]
      }
      story_views: {
        Row: {
          profile_id: number
          story_id: number
          viewed_at: string
        }
        ComputedFields: never
        Insert: {
          profile_id: number
          story_id: number
          viewed_at?: string
        }
        Update: {
          profile_id?: number
          story_id?: number
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_views_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_views_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      user_timetables: {
        Row: {
          active_semester: string
          profile_id: number
          semesters: NonNullable<Json>
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          active_semester?: string
          profile_id: number
          semesters?: NonNullable<Json>
          updated_at?: string
        }
        Update: {
          active_semester?: string
          profile_id?: number
          semesters?: NonNullable<Json>
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_timetables_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      utility_reservations: {
        Row: {
          applicant_name: string
          avatar_path: string | null
          created_at: string
          detail: string
          id: number
          location: string | null
          mode: string
          profile_id: number
          recurring: boolean
          recurring_until: string | null
          reservation_date: string
          slot: string
        }
        ComputedFields: never
        Insert: {
          applicant_name: string
          avatar_path?: string | null
          created_at?: string
          detail: string
          id?: never
          location?: string | null
          mode: string
          profile_id: number
          recurring?: boolean
          recurring_until?: string | null
          reservation_date: string
          slot: string
        }
        Update: {
          applicant_name?: string
          avatar_path?: string | null
          created_at?: string
          detail?: string
          id?: never
          location?: string | null
          mode?: string
          profile_id?: number
          recurring?: boolean
          recurring_until?: string | null
          reservation_date?: string
          slot?: string
        }
        Relationships: [
          {
            foreignKeyName: "utility_reservations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_group_invite: { Args: { p_token: string }; Returns: string }
      add_conversation_members: {
        Args: { p_conversation_id: string; p_profile_ids: number[] }
        Returns: undefined
      }
      admin_lift_suspension: { Args: { p_profile_id: number }; Returns: number }
      admin_list_accepted_users: {
        Args: {
          p_limit?: number
          p_managers_only?: boolean
          p_offset?: number
          p_query?: string
        }
        Returns: {
          cohort: number
          department: string
          has_gongang_manage: boolean
          name: string
          profile_id: number
          profile_type: Database["public"]["Enums"]["profile_type"]
          pub_id: string
          total_count: number
        }[]
      }
      admin_list_applications: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_status: Database["public"]["Enums"]["profile_status"]
        }
        Returns: {
          birthday: string
          cohort: number
          gender: Database["public"]["Enums"]["profile_gender"]
          is_returning_student: boolean
          name: string
          profile_id: number
          profile_type: Database["public"]["Enums"]["profile_type"]
          student_number: string
          submitted_at: string
          total_count: number
        }[]
      }
      admin_list_members: {
        Args: {
          p_admins_only?: boolean
          p_limit?: number
          p_offset?: number
          p_query?: string
        }
        Returns: {
          cohort: number
          department: string
          is_app_admin: boolean
          is_self: boolean
          name: string
          profile_id: number
          profile_type: Database["public"]["Enums"]["profile_type"]
          pub_id: string
          total_count: number
        }[]
      }
      admin_list_roster: {
        Args: Record<PropertyKey, never>
        Returns: {
          approved_at: string
          cohort: number
          department: string
          is_app_admin: boolean
          is_suspended: boolean
          name: string
          profile_id: number
          profile_type: Database["public"]["Enums"]["profile_type"]
          pub_id: string
          suspension_expires_at: string
        }[]
      }
      admin_replace_contacts: { Args: { p_contacts: Json }; Returns: undefined }
      admin_review_applications: {
        Args: {
          p_profile_ids: number[]
          p_status: Database["public"]["Enums"]["profile_status"]
        }
        Returns: {
          profile_id: number
          status: Database["public"]["Enums"]["profile_status"]
          status_updated_at: string
        }[]
      }
      admin_school_notice_status: {
        Args: Record<PropertyKey, never>
        Returns: {
          account_configured: boolean
          account_updated_at: string
          last_attempt_at: string
          last_error: string
          last_error_at: string
          last_requested_at: string
          last_success_at: string
          login_id: string
          notice_count: number
          sync_configured: boolean
        }[]
      }
      admin_set_app_admin: {
        Args: { p_enabled: boolean; p_profile_id: number }
        Returns: {
          is_app_admin: boolean
          profile_id: number
        }[]
      }
      admin_set_gongang_manager: {
        Args: { p_enabled: boolean; p_profile_id: number }
        Returns: {
          has_gongang_manage: boolean
          profile_id: number
        }[]
      }
      admin_set_school_notice_account: {
        Args: { p_login_id: string; p_password: string }
        Returns: undefined
      }
      admin_storage_cleanup_status: {
        Args: Record<PropertyKey, never>
        Returns: {
          last_cron_at: string
          last_cron_status: string
          last_run_error: string
          last_run_failed: number
          last_run_finished_at: string
          last_run_removed: number
          last_run_started_at: string
          last_run_status_code: number
          queue_dry_run: number
          queue_oldest_enqueued_at: string
          queue_pending: number
          queue_retrying: number
          secrets_configured: boolean
        }[]
      }
      admin_suspend_profile: {
        Args: {
          p_duration_days?: number
          p_profile_id: number
          p_reason: string
        }
        Returns: {
          expires_at: string
          suspension_id: number
        }[]
      }
      admin_sync_school_notices: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      admin_unblock_application: {
        Args: { p_profile_id: number }
        Returns: {
          profile_id: number
          status: Database["public"]["Enums"]["profile_status"]
          status_updated_at: string
        }[]
      }
      approve_group_join_request: {
        Args: { p_group_id: string; p_request_id: string }
        Returns: undefined
      }
      cancel_group_anonymous_activity_restriction: {
        Args: { p_source_id: string; p_source_kind: string }
        Returns: string
      }
      cancel_utility_reservation: {
        Args: { p_effective_date?: string; p_reservation_id: number }
        Returns: undefined
      }
      claim_notification_deliveries: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          auth: string
          body: string
          category: Database["public"]["Enums"]["notification_category"]
          channel: "web_push" | "email"
          conversation_id: string
          delivery_id: string
          endpoint: string
          grouping_key: string
          importance: Database["public"]["Enums"]["notification_importance"]
          lease_id: string
          message_id: string
          notification_id: string
          p256dh: string
          recipient_email: string
          tag: string
          title: string
        }[]
      }
      claim_storage_cleanup: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          bucket: string
          id: string
          lease_id: string
          object_path: string
        }[]
      }
      clear_comment_reaction: {
        Args: { p_comment_id: string }
        Returns: {
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          reaction_count: number
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
      clear_post_reaction: {
        Args: { p_post_id: string }
        Returns: {
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          reaction_count: number
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
      commit_group_post: {
        Args: {
          p_attachment_ids: string[]
          p_body: string
          p_category_id?: string
          p_mention_pub_ids?: string[]
          p_post_id: string
          p_publish?: boolean
          p_title: string
        }
        Returns: string
      }
      commit_profile_post: {
        Args: {
          p_attachment_ids: string[]
          p_body: string
          p_post_id: string
          p_publish?: boolean
          p_visibility?: Database["public"]["Enums"]["post_visibility"]
        }
        Returns: string
      }
      complete_notification_delivery: {
        Args: {
          p_delivery_id: string
          p_error_code?: string
          p_lease_id: string
          p_outcome: string
          p_status_code?: number
        }
        Returns: boolean
      }
      complete_storage_cleanup: {
        Args: {
          p_error?: string
          p_ids: string[]
          p_lease_id: string
          p_removed_ids?: string[]
        }
        Returns: number
      }
      create_group: {
        Args: {
          p_description?: string
          p_hide_staff_roles?: boolean
          p_identity_policy?: Database["public"]["Enums"]["group_identity_policy"]
          p_join_policy?: Database["public"]["Enums"]["group_join_policy"]
          p_kind: Database["public"]["Enums"]["group_kind"]
          p_name: string
          p_posting_policy?: Database["public"]["Enums"]["group_posting_policy"]
          p_slug?: string
        }
        Returns: {
          group_id: string
          slug: string
        }[]
      }
      create_group_category: {
        Args: { p_group_id: string; p_name: string; p_position?: number }
        Returns: {
          created_at: string
          group_id: string
          id: string
          name: string
          position: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "group_categories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_group_conversation: {
        Args: { p_name: string; p_profile_ids: number[] }
        Returns: string
      }
      create_group_post: {
        Args: {
          p_author_identity: Database["public"]["Enums"]["post_identity"]
          p_body: string
          p_category_id?: string
          p_group_id: string
          p_mention_pub_ids?: string[]
          p_publish?: boolean
          p_title: string
        }
        Returns: string
      }
      create_group_post_upload_draft: {
        Args: {
          p_author_identity: Database["public"]["Enums"]["post_identity"]
          p_group_id: string
        }
        Returns: string
      }
      create_post_comment: {
        Args: {
          p_author_identity: Database["public"]["Enums"]["post_identity"]
          p_body: string
          p_image_id?: string
          p_mention_pub_ids?: string[]
          p_parent_comment_id?: string
          p_post_id: string
        }
        Returns: {
          anonymous_author_restricted: boolean
          anonymous_author_restriction_expires_at: string
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          author_pub_id: string
          body: string
          can_delete: boolean
          can_edit: boolean
          can_moderate_anonymous: boolean
          comment_id: string
          created_at: string
          depth: number
          edited_at: string
          is_author: boolean
          is_deleted: boolean
          is_effective_feed_bump: boolean
          mentions: Json
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          parent_author_label: string
          parent_comment_id: string
          post_comment_count: number
          post_id: string
          reaction_count: number
          reply_count: number
          root_comment_id: string
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
      create_profile_post: {
        Args: {
          p_timeline_pub_id: string
          p_visibility?: Database["public"]["Enums"]["post_visibility"]
        }
        Returns: string
      }
      create_text_story: {
        Args: {
          p_audience?: Database["public"]["Enums"]["story_audience"]
          p_background: string
          p_content: string
          p_layout?: Json
          p_link_url?: string
        }
        Returns: number
      }
      delete_group: { Args: { p_group_id: string }; Returns: undefined }
      delete_group_category: {
        Args: { p_category_id: string }
        Returns: undefined
      }
      delete_group_conversation: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      delete_group_post: { Args: { p_post_id: string }; Returns: undefined }
      delete_messages: { Args: { p_message_ids: string[] }; Returns: undefined }
      delete_my_story: { Args: { p_story_id: number }; Returns: undefined }
      delete_post_attachment: {
        Args: { p_attachment_id: string }
        Returns: undefined
      }
      delete_post_comment: { Args: { p_comment_id: string }; Returns: number }
      delete_profile_post: { Args: { p_post_id: string }; Returns: undefined }
      discover_groups: {
        Args: {
          p_after_id?: string
          p_after_member_count?: number
          p_after_rank?: number
          p_include_joined?: boolean
          p_limit?: number
          p_query?: string
        }
        Returns: {
          cover_path: string
          description: string
          group_id: string
          icon_path: string
          identity_policy: Database["public"]["Enums"]["group_identity_policy"]
          join_policy: Database["public"]["Enums"]["group_join_policy"]
          member_count: number
          member_role: Database["public"]["Enums"]["group_member_role"]
          membership_state: string
          name: string
          requested_at: string
          slug: string
          sort_rank: number
        }[]
      }
      dismiss_group_post_reports: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      donation_cancel_claim: { Args: { p_item_id: number }; Returns: undefined }
      donation_claim_item: { Args: { p_item_id: number }; Returns: undefined }
      donation_create_round: {
        Args: { p_closes_at: string; p_opens_at: string; p_title: string }
        Returns: number
      }
      donation_import_items: {
        Args: { p_items: Json; p_round_id: number }
        Returns: number
      }
      donation_list_claimed_by: {
        Args: { p_round_id: number }
        Returns: {
          applicant_cohort: number
          applicant_name: string
          item_id: number
        }[]
      }
      donation_list_claims: {
        Args: { p_round_id: number }
        Returns: {
          applicant: string
          applicant_cohort: number
          applicant_pub_id: string
          applied_at: string
          cancelled_at: string
          category: string
          detail: string
          donor_name: string
          item_id: number
          item_name: string
        }[]
      }
      donation_list_items: {
        Args: { p_round_id: number }
        Returns: {
          category: string
          detail: string
          donor_name: string
          id: number
          is_claimed: boolean
          is_mine: boolean
          name: string
        }[]
      }
      donation_list_rounds: {
        Args: Record<PropertyKey, never>
        Returns: {
          closes_at: string
          id: number
          is_open: boolean
          opens_at: string
          title: string
        }[]
      }
      donation_update_round: {
        Args: {
          p_closes_at: string
          p_opens_at: string
          p_round_id: number
          p_title: string
        }
        Returns: undefined
      }
      edit_message: {
        Args: {
          p_body: string
          p_mention_pub_ids?: string[]
          p_message_id: string
        }
        Returns: string
      }
      finalize_comment_image: {
        Args: { p_image_id: string }
        Returns: {
          comment_id: string | null
          created_at: string
          deleted_at: string | null
          finalized_at: string | null
          height: number
          id: string
          mime_type: string
          object_path: string
          post_id: string
          ready_at: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["comment_image_status"]
          storage_bucket: string
          width: number
        }
        SetofOptions: {
          from: "*"
          to: "comment_images"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_group_media: { Args: { p_media_id: string }; Returns: string }
      finalize_post_attachment: {
        Args: { p_attachment_id: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          height: number | null
          id: string
          mime_type: string
          object_path: string
          original_filename: string
          position: number
          post_id: string
          ready_at: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["post_attachment_status"]
          storage_bucket: string
          thumbnail_path: string | null
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "post_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_profile_media: {
        Args: { p_media_id: string }
        Returns: {
          academic_track:
            Database["public"]["Enums"]["profile_academic_track"] | null
          allow_timeline_posts: boolean
          anonymous_username: string | null
          auth_user_id: string | null
          avatar_path: string | null
          birthday: string | null
          class_no: number | null
          cohort: number | null
          contact_email: string | null
          cover_path: string | null
          created_at: string
          deleted_at: string | null
          department: string | null
          description: string | null
          dorm_room: number | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          id: number
          is_returning_student: boolean
          name: string
          onboarding_completed_at: string
          phone_number: string | null
          pub_id: string
          role: Database["public"]["Enums"]["app_role"]
          search_name: string | null
          status: Database["public"]["Enums"]["profile_status"]
          status_updated_at: string
          status_updated_by: number | null
          student_number: string | null
          submitted_at: string
          type: Database["public"]["Enums"]["profile_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_accepted_profile: {
        Args: { p_pub_id: string }
        Returns: {
          academic_track: Database["public"]["Enums"]["profile_academic_track"]
          allow_timeline_posts: boolean
          avatar_path: string
          birthday: string
          class_no: number
          cohort: number
          contact_email: string
          cover_path: string
          department: string
          description: string
          dorm_room: number
          gender: Database["public"]["Enums"]["profile_gender"]
          id: number
          is_returning_student: boolean
          name: string
          phone_number: string
          pub_id: string
          role: Database["public"]["Enums"]["app_role"]
          student_number: string
          type: Database["public"]["Enums"]["profile_type"]
        }[]
      }
      get_conversation_attachment_counts: {
        Args: { p_conversation_id: string }
        Returns: {
          file_count: number
          media_count: number
        }[]
      }
      get_group_invite: {
        Args: { p_group_id: string }
        Returns: {
          allowed_profile_types: Database["public"]["Enums"]["profile_type"][]
          expires_at: string
          token: string
        }[]
      }
      get_group_invite_preview: {
        Args: { p_token: string }
        Returns: {
          allowed_profile_types: Database["public"]["Enums"]["profile_type"][]
          already_member: boolean
          description: string
          expires_at: string
          group_id: string
          identity_policy: Database["public"]["Enums"]["group_identity_policy"]
          join_policy: Database["public"]["Enums"]["group_join_policy"]
          member_count: number
          name: string
          posting_policy: Database["public"]["Enums"]["group_posting_policy"]
          profile_type_allowed: boolean
          slug: string
        }[]
      }
      get_group_link_preview: {
        Args: { p_slug: string }
        Returns: {
          description: string
          group_id: string
          identity_policy: Database["public"]["Enums"]["group_identity_policy"]
          join_policy: Database["public"]["Enums"]["group_join_policy"]
          member_count: number
          name: string
          posting_policy: Database["public"]["Enums"]["group_posting_policy"]
          requested_at: string
          slug: string
        }[]
      }
      get_group_post: {
        Args: { p_post_id: string }
        Returns: {
          anonymous_author_restricted: boolean
          anonymous_author_restriction_expires_at: string
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          author_pub_id: string
          body: string
          can_delete: boolean
          can_edit: boolean
          can_moderate_anonymous: boolean
          can_pin: boolean
          category_id: string
          category_name: string
          comment_count: number
          edited_at: string
          group_id: string
          is_author: boolean
          is_pinned: boolean
          mentions: Json
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          post_id: string
          published_at: string
          reaction_count: number
          title: string
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
      get_my_group_anonymous_activity_restriction: {
        Args: { p_group_id: string }
        Returns: {
          expires_at: string
          reason: string
        }[]
      }
      get_my_group_new_post_counts: {
        Args: Record<PropertyKey, never>
        Returns: {
          group_id: string
          new_post_count: number
        }[]
      }
      get_my_notification_preferences: {
        Args: Record<PropertyKey, never>
        Returns: {
          account_push_enabled: boolean
          content_push_enabled: boolean
          group_push_enabled: boolean
          message_preview_hidden: boolean
          school_push_enabled: boolean
          timeline_push_enabled: boolean
        }[]
      }
      get_my_profile: {
        Args: Record<PropertyKey, never>
        Returns: {
          academic_track:
            Database["public"]["Enums"]["profile_academic_track"] | null
          allow_timeline_posts: boolean
          anonymous_username: string | null
          auth_user_id: string | null
          avatar_path: string | null
          birthday: string | null
          class_no: number | null
          cohort: number | null
          contact_email: string | null
          cover_path: string | null
          created_at: string
          deleted_at: string | null
          department: string | null
          description: string | null
          dorm_room: number | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          id: number
          is_returning_student: boolean
          name: string
          onboarding_completed_at: string
          phone_number: string | null
          pub_id: string
          role: Database["public"]["Enums"]["app_role"]
          search_name: string | null
          status: Database["public"]["Enums"]["profile_status"]
          status_updated_at: string
          status_updated_by: number | null
          student_number: string | null
          submitted_at: string
          type: Database["public"]["Enums"]["profile_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_recent_unread_notification_count: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      get_my_suspension: {
        Args: Record<PropertyKey, never>
        Returns: {
          expires_at: string
          reason: string
        }[]
      }
      get_my_unread_message_count: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      get_my_web_push_status: {
        Args: { p_endpoint: string }
        Returns: {
          gone: boolean
          subscribed: boolean
        }[]
      }
      get_profile_post: {
        Args: { p_post_id: string }
        Returns: {
          activity_kind: Database["public"]["Enums"]["profile_media_activity_kind"]
          activity_media_path: string
          author_avatar_path: string
          author_name: string
          author_pub_id: string
          body: string
          can_delete: boolean
          can_edit: boolean
          comment_count: number
          edited_at: string
          is_author: boolean
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          post_id: string
          published_at: string
          reaction_count: number
          timeline_name: string
          timeline_pub_id: string
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
          visibility: Database["public"]["Enums"]["post_visibility"]
        }[]
      }
      get_school_notice: {
        Args: { p_post_id: number }
        Returns: {
          attachments: Json
          author: string
          body: string
          category: string
          post_id: number
          posted_on: string
          title: string
        }[]
      }
      issue_group_invite: {
        Args: {
          p_allowed_profile_types?: Database["public"]["Enums"]["profile_type"][]
          p_group_id: string
          p_hours?: number
        }
        Returns: {
          allowed_profile_types: Database["public"]["Enums"]["profile_type"][]
          expires_at: string
          token: string
        }[]
      }
      leave_conversation: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      list_active_stories: {
        Args: Record<PropertyKey, never>
        Returns: {
          audience: Database["public"]["Enums"]["story_audience"]
          avatar_path: string
          background: string
          content: string
          image_height: number
          image_path: string
          image_width: number
          layout: Json
          link_url: string
          name: string
          pub_id: string
          published_at: string
          story_id: number
          thumbnail_path: string
        }[]
      }
      list_birthdays: {
        Args: { p_reference_date: string; p_scope?: string }
        Returns: {
          avatar_path: string
          birthday_date: string
          birthday_day: number
          birthday_month: number
          cohort: number
          is_returning_student: boolean
          name: string
          pub_id: string
        }[]
      }
      list_comment_images: {
        Args: { p_comment_ids: string[] }
        Returns: {
          comment_id: string
          height: number
          image_id: string
          mime_type: string
          object_path: string
          post_id: string
          ready_at: string
          size_bytes: number
          storage_bucket: string
          width: number
        }[]
      }
      list_comment_reactors: {
        Args: { p_comment_id: string }
        Returns: {
          reacted_at: string
          reaction: Database["public"]["Enums"]["post_reaction"]
          reactor_avatar_path: string
          reactor_name: string
          reactor_pub_id: string
        }[]
      }
      list_conversation_attachments: {
        Args: {
          p_before_id?: string
          p_before_sent_at?: string
          p_conversation_id: string
          p_limit?: number
          p_media: boolean
        }
        Returns: {
          file_name: string
          height: number
          id: string
          kind: string
          message_id: string
          mime_type: string
          object_path: string
          sender_id: number
          sent_at: string
          size_bytes: number
          thumbnail_path: string
          width: number
        }[]
      }
      list_conversations: {
        Args: { p_conversation_id?: string }
        Returns: {
          can_delete: boolean
          conversation_id: string
          hidden: boolean
          last_message_attachment_kind: string
          last_message_body: string
          last_message_deleted: boolean
          last_message_id: string
          last_message_sender_id: number
          last_message_sent_at: string
          muted: boolean
          name: string
          notification_level: Database["public"]["Enums"]["conversation_notification_level"]
          participants: Json
          type: Database["public"]["Enums"]["conversation_type"]
          unread_count: number
          viewer_id: number
        }[]
      }
      list_feed_posts: {
        Args: { p_page_token?: string }
        Returns: {
          activity_kind: Database["public"]["Enums"]["profile_media_activity_kind"]
          activity_media_path: string
          attachments: Json
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          author_pub_id: string
          body: string
          category_name: string
          comment_count: number
          edited_at: string
          feed_epoch: string
          feed_position: number
          group_id: string
          group_name: string
          group_slug: string
          is_author: boolean
          is_pinned: boolean
          kind: Database["public"]["Enums"]["post_kind"]
          mentions: Json
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          next_page_token: string
          post_id: string
          published_at: string
          rank_time: string
          reaction_count: number
          timeline_name: string
          timeline_pub_id: string
          title: string
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
          visibility: Database["public"]["Enums"]["post_visibility"]
        }[]
      }
      list_group_join_requests: {
        Args: { p_group_id: string }
        Returns: {
          avatar_path: string
          cohort: number
          is_returning_student: boolean
          name: string
          pub_id: string
          request_id: string
          requested_at: string
        }[]
      }
      list_group_members: {
        Args: {
          p_after_joined_at?: string
          p_after_membership_id?: string
          p_after_role?: Database["public"]["Enums"]["group_member_role"]
          p_group_id: string
          p_limit?: number
          p_query?: string
        }
        Returns: {
          avatar_path: string
          cohort: number
          is_returning_student: boolean
          joined_at: string
          membership_id: string
          name: string
          pub_id: string
          role: Database["public"]["Enums"]["group_member_role"]
        }[]
      }
      list_group_post_report_descriptions: {
        Args: {
          p_before_created_at?: string
          p_before_report_id?: number
          p_group_id: string
          p_limit?: number
          p_post_id: string
        }
        Returns: {
          created_at: string
          description: string
          reason: Database["public"]["Enums"]["group_post_report_reason"]
          report_id: number
        }[]
      }
      list_group_post_report_summaries: {
        Args: {
          p_cursor_latest_at?: string
          p_cursor_post_id?: string
          p_cursor_report_count?: number
          p_group_id: string
          p_limit?: number
          p_sort?: string
        }
        Returns: {
          abuse_count: number
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          author_pub_id: string
          body_preview: string
          description_count: number
          dismissed_count: number
          impersonation_count: number
          latest_at: string
          other_count: number
          post_id: string
          privacy_count: number
          report_count: number
          sexual_count: number
          spam_count: number
          title: string
        }[]
      }
      list_group_posts: {
        Args: {
          p_category_id?: string
          p_cursor_is_pinned?: boolean
          p_cursor_post_id?: string
          p_cursor_published_at?: string
          p_group_id: string
          p_limit?: number
        }
        Returns: {
          anonymous_author_restricted: boolean
          anonymous_author_restriction_expires_at: string
          attachments: Json
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          author_pub_id: string
          body: string
          can_delete: boolean
          can_edit: boolean
          can_moderate_anonymous: boolean
          can_pin: boolean
          category_id: string
          category_name: string
          comment_count: number
          edited_at: string
          group_id: string
          is_author: boolean
          is_pinned: boolean
          mentions: Json
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          post_id: string
          published_at: string
          reaction_count: number
          title: string
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
      list_message_changes: {
        Args: { p_conversation_id: string; p_limit?: number; p_since: string }
        Returns: {
          attachments: Json
          body: string
          changed_at: string
          deleted: boolean
          edited_at: string
          id: string
          mention_profile_ids: number[]
          mentions_everyone: boolean
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          pinned: boolean
          reactions: Json
          reply_attachment_kind: string
          reply_body: string
          reply_deleted: boolean
          reply_sender_id: number
          reply_to_id: string
          sender_id: number
          sent_at: string
          system_kind: string
          system_name: string
          system_profile_ids: number[]
          unread_member_count: number
        }[]
      }
      list_message_reactors: {
        Args: { p_message_id: string }
        Returns: {
          avatar_path: string
          name: string
          profile_id: number
          reacted_at: string
          reaction: Database["public"]["Enums"]["post_reaction"]
        }[]
      }
      list_message_read_counts: {
        Args: { p_conversation_id: string; p_message_ids: string[] }
        Returns: {
          id: string
          unread_member_count: number
        }[]
      }
      list_messages: {
        Args: {
          p_before_id?: string
          p_before_sent_at?: string
          p_conversation_id: string
          p_limit?: number
        }
        Returns: {
          attachments: Json
          body: string
          changed_at: string
          deleted: boolean
          edited_at: string
          id: string
          mention_profile_ids: number[]
          mentions_everyone: boolean
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          pinned: boolean
          reactions: Json
          reply_attachment_kind: string
          reply_body: string
          reply_deleted: boolean
          reply_sender_id: number
          reply_to_id: string
          sender_id: number
          sent_at: string
          system_kind: string
          system_name: string
          system_profile_ids: number[]
          unread_member_count: number
        }[]
      }
      list_my_notifications: {
        Args: {
          p_before_id?: string
          p_before_last_activity_at?: string
          p_limit?: number
        }
        Returns: {
          actor_avatar_path: string
          actor_count: number
          actor_display_name: string
          actor_identity: Database["public"]["Enums"]["notification_actor_identity"]
          category: Database["public"]["Enums"]["notification_category"]
          comment_excerpt: string
          comment_id: string
          created_at: string
          detail: string
          group_id: string
          group_name: string
          id: string
          importance: Database["public"]["Enums"]["notification_importance"]
          kind: Database["public"]["Enums"]["notification_kind"]
          last_activity_at: string
          post_id: string
          reaction: Database["public"]["Enums"]["post_reaction"]
          read_at: string
          reservation_id: number
          restriction_expires_at: string
          target_profile_id: number
          title: string
        }[]
      }
      list_pinned_messages: {
        Args: { p_conversation_id: string }
        Returns: {
          attachments: Json
          body: string
          changed_at: string
          deleted: boolean
          edited_at: string
          id: string
          mention_profile_ids: number[]
          mentions_everyone: boolean
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          pinned: boolean
          reactions: Json
          reply_attachment_kind: string
          reply_body: string
          reply_deleted: boolean
          reply_sender_id: number
          reply_to_id: string
          sender_id: number
          sent_at: string
          system_kind: string
          system_name: string
          system_profile_ids: number[]
          unread_member_count: number
        }[]
      }
      list_post_attachments: {
        Args: { p_post_id: string }
        Returns: {
          attachment_id: string
          created_at: string
          height: number
          mime_type: string
          object_path: string
          original_filename: string
          position: number
          post_id: string
          ready_at: string
          size_bytes: number
          status: Database["public"]["Enums"]["post_attachment_status"]
          storage_bucket: string
          thumbnail_path: string
          width: number
        }[]
      }
      list_post_comment_replies: {
        Args: { p_root_comment_id: string }
        Returns: {
          anonymous_author_restricted: boolean
          anonymous_author_restriction_expires_at: string
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          author_pub_id: string
          body: string
          can_delete: boolean
          can_edit: boolean
          can_moderate_anonymous: boolean
          comment_id: string
          created_at: string
          depth: number
          edited_at: string
          images: Json
          is_author: boolean
          is_deleted: boolean
          is_effective_feed_bump: boolean
          mentions: Json
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          parent_author_label: string
          parent_comment_id: string
          post_id: string
          reaction_count: number
          reply_count: number
          root_comment_id: string
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
      list_post_comments: {
        Args: {
          p_cursor_comment_id?: string
          p_cursor_created_at?: string
          p_limit?: number
          p_post_id: string
        }
        Returns: {
          anonymous_author_restricted: boolean
          anonymous_author_restriction_expires_at: string
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          author_pub_id: string
          body: string
          can_delete: boolean
          can_edit: boolean
          can_moderate_anonymous: boolean
          comment_id: string
          created_at: string
          depth: number
          edited_at: string
          images: Json
          is_author: boolean
          is_deleted: boolean
          is_effective_feed_bump: boolean
          mentions: Json
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          parent_author_label: string
          parent_comment_id: string
          post_id: string
          reaction_count: number
          reply_count: number
          root_comment_id: string
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
      list_post_previews: {
        Args: { p_post_ids: string[] }
        Returns: {
          activity_kind: Database["public"]["Enums"]["profile_media_activity_kind"]
          activity_media_path: string
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          body: string
          group_name: string
          image_path: string
          kind: Database["public"]["Enums"]["post_kind"]
          post_id: string
          title: string
        }[]
      }
      list_post_reactors: {
        Args: { p_post_id: string }
        Returns: {
          reacted_at: string
          reaction: Database["public"]["Enums"]["post_reaction"]
          reactor_avatar_path: string
          reactor_name: string
          reactor_pub_id: string
        }[]
      }
      list_profile_posts: {
        Args: {
          p_cursor_post_id?: string
          p_cursor_published_at?: string
          p_limit?: number
          p_timeline_pub_id: string
        }
        Returns: {
          activity_kind: Database["public"]["Enums"]["profile_media_activity_kind"]
          activity_media_path: string
          attachments: Json
          author_avatar_path: string
          author_name: string
          author_pub_id: string
          body: string
          can_delete: boolean
          can_edit: boolean
          comment_count: number
          edited_at: string
          is_author: boolean
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          post_id: string
          published_at: string
          reaction_count: number
          timeline_name: string
          timeline_pub_id: string
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
          visibility: Database["public"]["Enums"]["post_visibility"]
        }[]
      }
      list_school_notices: {
        Args: Record<PropertyKey, never>
        Returns: {
          author: string
          category: string
          has_attachment: boolean
          post_id: number
          posted_on: string
          synced_at: string
          title: string
        }[]
      }
      list_story_viewers: {
        Args: { p_story_id: number }
        Returns: {
          avatar_path: string
          name: string
          pub_id: string
          reactions: Database["public"]["Enums"]["post_reaction"][]
          viewed_at: string
        }[]
      }
      mark_all_my_notifications_read: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string; p_message_id: string }
        Returns: boolean
      }
      mark_group_posts_visited: {
        Args: { p_group_id: string }
        Returns: undefined
      }
      mark_my_notification_read: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      mark_story_viewed: { Args: { p_story_id: number }; Returns: undefined }
      move_group_category: {
        Args: { p_category_id: string; p_direction: number }
        Returns: {
          created_at: string
          group_id: string
          id: string
          name: string
          position: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "group_categories"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      next_message_delivery_at: {
        Args: { p_within_seconds?: number }
        Returns: string
      }
      open_direct_conversation: {
        Args: { p_profile_id: number }
        Returns: string
      }
      prepare_comment_image: {
        Args: {
          p_height: number
          p_mime_type: string
          p_post_id: string
          p_size_bytes: number
          p_width: number
        }
        Returns: {
          comment_id: string | null
          created_at: string
          deleted_at: string | null
          finalized_at: string | null
          height: number
          id: string
          mime_type: string
          object_path: string
          post_id: string
          ready_at: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["comment_image_status"]
          storage_bucket: string
          width: number
        }
        SetofOptions: {
          from: "*"
          to: "comment_images"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_group_media: {
        Args: {
          p_group_id: string
          p_height: number
          p_size_bytes: number
          p_slot: Database["public"]["Enums"]["group_media_slot"]
          p_width: number
        }
        Returns: {
          media_id: string
          object_path: string
        }[]
      }
      prepare_image_story: {
        Args: {
          p_audience?: Database["public"]["Enums"]["story_audience"]
          p_content?: string
          p_height: number
          p_layout?: Json
          p_link_url?: string
          p_size_bytes: number
          p_width: number
        }
        Returns: {
          object_path: string
          story_id: number
          thumbnail_path: string
        }[]
      }
      prepare_message_attachments: {
        Args: { p_conversation_id: string; p_files: Json; p_message_id: string }
        Returns: {
          attachment_id: string
          object_path: string
          thumbnail_path: string
        }[]
      }
      prepare_notification_delivery: {
        Args: { p_delivery_id: string; p_lease_id: string }
        Returns: boolean
      }
      prepare_post_attachment: {
        Args: {
          p_height?: number
          p_mime_type: string
          p_original_filename: string
          p_post_id: string
          p_size_bytes: number
          p_width?: number
        }
        Returns: {
          created_at: string
          deleted_at: string | null
          height: number | null
          id: string
          mime_type: string
          object_path: string
          original_filename: string
          position: number
          post_id: string
          ready_at: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["post_attachment_status"]
          storage_bucket: string
          thumbnail_path: string | null
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "post_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_profile_media: {
        Args: {
          p_activity_height?: number
          p_activity_size_bytes?: number
          p_activity_width?: number
          p_height: number
          p_size_bytes: number
          p_slot: Database["public"]["Enums"]["profile_media_slot"]
          p_width: number
        }
        Returns: {
          activity_media_id: string
          activity_object_path: string
          media_id: string
          object_path: string
        }[]
      }
      publish_image_story: { Args: { p_story_id: number }; Returns: undefined }
      record_school_notice_sync: {
        Args: { p_error: string; p_notices: Json }
        Returns: undefined
      }
      register_my_web_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_expiration_time?: number
          p_p256dh: string
        }
        Returns: boolean
      }
      reject_group_join_request: {
        Args: { p_group_id: string; p_request_id: string }
        Returns: undefined
      }
      remove_group_media: {
        Args: {
          p_group_id: string
          p_slot: Database["public"]["Enums"]["group_media_slot"]
        }
        Returns: undefined
      }
      remove_my_profile_media: {
        Args: { p_slot: string }
        Returns: {
          academic_track:
            Database["public"]["Enums"]["profile_academic_track"] | null
          allow_timeline_posts: boolean
          anonymous_username: string | null
          auth_user_id: string | null
          avatar_path: string | null
          birthday: string | null
          class_no: number | null
          cohort: number | null
          contact_email: string | null
          cover_path: string | null
          created_at: string
          deleted_at: string | null
          department: string | null
          description: string | null
          dorm_room: number | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          id: number
          is_returning_student: boolean
          name: string
          onboarding_completed_at: string
          phone_number: string | null
          pub_id: string
          role: Database["public"]["Enums"]["app_role"]
          search_name: string | null
          status: Database["public"]["Enums"]["profile_status"]
          status_updated_at: string
          status_updated_by: number | null
          student_number: string | null
          submitted_at: string
          type: Database["public"]["Enums"]["profile_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rename_conversation: {
        Args: { p_conversation_id: string; p_name: string }
        Returns: undefined
      }
      report_group_post: {
        Args: {
          p_description?: string
          p_post_id: string
          p_reason: Database["public"]["Enums"]["group_post_report_reason"]
        }
        Returns: undefined
      }
      resolve_my_notification_destination: {
        Args: { p_notification_id: string }
        Returns: string
      }
      restrict_group_anonymous_activity: {
        Args: {
          p_duration_days: number
          p_reason: string
          p_source_id: string
          p_source_kind: string
        }
        Returns: {
          expires_at: string
          restriction_id: string
        }[]
      }
      revoke_group_invite: { Args: { p_group_id: string }; Returns: undefined }
      save_gongang_schedule: { Args: { p_entries: Json }; Returns: undefined }
      school_notice_credentials: {
        Args: Record<PropertyKey, never>
        Returns: {
          login_id: string
          password: string
        }[]
      }
      search_directory: {
        Args: { p_query?: string }
        Returns: {
          avatar_path: string
          result_id: string
          result_kind: string
          result_name: string
          sort_rank: number
        }[]
      }
      search_group_mention_candidates: {
        Args: { p_group_id: string; p_limit?: number; p_query?: string }
        Returns: {
          avatar_path: string
          cohort: number
          is_returning_student: boolean
          name: string
          profile_type: Database["public"]["Enums"]["profile_type"]
          pub_id: string
        }[]
      }
      search_group_posts: {
        Args: { p_group_id: string; p_limit?: number; p_query: string }
        Returns: {
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          author_pub_id: string
          body: string
          can_delete: boolean
          can_edit: boolean
          can_pin: boolean
          category_id: string
          category_name: string
          edited_at: string
          group_id: string
          is_author: boolean
          is_pinned: boolean
          post_id: string
          published_at: string
          title: string
        }[]
      }
      search_message_recipients: {
        Args: { p_query: string }
        Returns: {
          avatar_path: string
          cohort: number
          name: string
          profile_id: number
          profile_type: Database["public"]["Enums"]["profile_type"]
          pub_id: string
        }[]
      }
      search_messages: {
        Args: {
          p_before_id?: string
          p_before_sent_at?: string
          p_conversation_id: string
          p_limit?: number
          p_query: string
        }
        Returns: Json
      }
      send_message: {
        Args: {
          p_body: string
          p_conversation_id: string
          p_mark_read?: boolean
          p_mention_pub_ids?: string[]
          p_message_id: string
          p_reply_to_id?: string
        }
        Returns: {
          id: string
          sent_at: string
        }[]
      }
      send_story_reaction: {
        Args: {
          p_reaction: Database["public"]["Enums"]["post_reaction"]
          p_story_id: number
        }
        Returns: undefined
      }
      set_comment_reaction: {
        Args: {
          p_comment_id: string
          p_reaction: Database["public"]["Enums"]["post_reaction"]
        }
        Returns: {
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          reaction_count: number
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
      set_conversation_hidden: {
        Args: { p_conversation_id: string; p_hidden: boolean }
        Returns: undefined
      }
      set_conversation_muted: {
        Args: { p_conversation_id: string; p_muted: boolean }
        Returns: undefined
      }
      set_conversation_notification_level: {
        Args: {
          p_conversation_id: string
          p_level: Database["public"]["Enums"]["conversation_notification_level"]
        }
        Returns: undefined
      }
      set_group_post_pinned: {
        Args: { p_pinned: boolean; p_post_id: string }
        Returns: string
      }
      set_message_pinned: {
        Args: { p_message_id: string; p_pinned: boolean }
        Returns: undefined
      }
      set_message_reaction: {
        Args: {
          p_message_id: string
          p_reaction?: Database["public"]["Enums"]["post_reaction"]
        }
        Returns: {
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          reactions: Json
        }[]
      }
      set_my_group_notification_preferences: {
        Args: {
          p_content_push_enabled: boolean
          p_group_id: string
          p_new_post_push_enabled: boolean
          p_notification_level: Database["public"]["Enums"]["group_notification_level"]
        }
        Returns: undefined
      }
      set_my_message_preview_hidden: {
        Args: { p_hidden: boolean }
        Returns: undefined
      }
      set_post_reaction: {
        Args: {
          p_post_id: string
          p_reaction: Database["public"]["Enums"]["post_reaction"]
        }
        Returns: {
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          reaction_count: number
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
      submit_my_profile: {
        Args: {
          p_academic_track?: Database["public"]["Enums"]["profile_academic_track"]
          p_birthday?: string
          p_class_no?: number
          p_cohort?: number
          p_dorm_room?: number
          p_gender?: Database["public"]["Enums"]["profile_gender"]
          p_name: string
          p_phone_number?: string
          p_student_number?: string
          p_type: Database["public"]["Enums"]["profile_type"]
        }
        Returns: {
          academic_track:
            Database["public"]["Enums"]["profile_academic_track"] | null
          allow_timeline_posts: boolean
          anonymous_username: string | null
          auth_user_id: string | null
          avatar_path: string | null
          birthday: string | null
          class_no: number | null
          cohort: number | null
          contact_email: string | null
          cover_path: string | null
          created_at: string
          deleted_at: string | null
          department: string | null
          description: string | null
          dorm_room: number | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          id: number
          is_returning_student: boolean
          name: string
          onboarding_completed_at: string
          phone_number: string | null
          pub_id: string
          role: Database["public"]["Enums"]["app_role"]
          search_name: string | null
          status: Database["public"]["Enums"]["profile_status"]
          status_updated_at: string
          status_updated_by: number | null
          student_number: string | null
          submitted_at: string
          type: Database["public"]["Enums"]["profile_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transfer_group_ownership: {
        Args: { p_group_id: string; p_target_membership_id: string }
        Returns: undefined
      }
      unregister_my_web_push_subscription: {
        Args: { p_endpoint: string }
        Returns: boolean
      }
      update_group_category: {
        Args: { p_category_id: string; p_name: string; p_position: number }
        Returns: {
          created_at: string
          group_id: string
          id: string
          name: string
          position: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "group_categories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_group_member_role: {
        Args: {
          p_group_id: string
          p_membership_id: string
          p_role: Database["public"]["Enums"]["group_member_role"]
        }
        Returns: undefined
      }
      update_group_post_draft_identity: {
        Args: {
          p_author_identity: Database["public"]["Enums"]["post_identity"]
          p_post_id: string
        }
        Returns: string
      }
      update_group_settings: {
        Args: {
          p_description: string
          p_group_id: string
          p_hide_staff_roles: boolean
          p_identity_policy: Database["public"]["Enums"]["group_identity_policy"]
          p_join_policy: Database["public"]["Enums"]["group_join_policy"]
          p_name: string
          p_posting_policy: Database["public"]["Enums"]["group_posting_policy"]
        }
        Returns: {
          description: string
          hide_staff_roles: boolean
          identity_policy: Database["public"]["Enums"]["group_identity_policy"]
          join_policy: Database["public"]["Enums"]["group_join_policy"]
          name: string
          posting_policy: Database["public"]["Enums"]["group_posting_policy"]
          updated_at: string
        }[]
      }
      update_my_notification_preferences: {
        Args: {
          p_account_push_enabled: boolean
          p_content_push_enabled: boolean
          p_group_push_enabled: boolean
          p_school_push_enabled: boolean
          p_timeline_push_enabled: boolean
        }
        Returns: undefined
      }
      update_my_profile: {
        Args: {
          p_academic_track?: Database["public"]["Enums"]["profile_academic_track"]
          p_allow_timeline_posts?: boolean
          p_birthday?: string
          p_class_no?: number
          p_cohort?: number
          p_contact_email?: string
          p_department?: string
          p_description?: string
          p_dorm_room?: number
          p_gender?: Database["public"]["Enums"]["profile_gender"]
          p_is_returning_student?: boolean
          p_name: string
          p_phone_number?: string
          p_pub_id?: string
        }
        Returns: {
          academic_track:
            Database["public"]["Enums"]["profile_academic_track"] | null
          allow_timeline_posts: boolean
          anonymous_username: string | null
          auth_user_id: string | null
          avatar_path: string | null
          birthday: string | null
          class_no: number | null
          cohort: number | null
          contact_email: string | null
          cover_path: string | null
          created_at: string
          deleted_at: string | null
          department: string | null
          description: string | null
          dorm_room: number | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          id: number
          is_returning_student: boolean
          name: string
          onboarding_completed_at: string
          phone_number: string | null
          pub_id: string
          role: Database["public"]["Enums"]["app_role"]
          search_name: string | null
          status: Database["public"]["Enums"]["profile_status"]
          status_updated_at: string
          status_updated_by: number | null
          student_number: string | null
          submitted_at: string
          type: Database["public"]["Enums"]["profile_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_post_comment: {
        Args: {
          p_body: string
          p_comment_id: string
          p_image_id?: string
          p_mention_pub_ids?: string[]
          p_remove_image?: boolean
        }
        Returns: {
          anonymous_author_restricted: boolean
          anonymous_author_restriction_expires_at: string
          author_avatar_path: string
          author_identity: Database["public"]["Enums"]["post_identity"]
          author_label: string
          author_name: string
          author_pub_id: string
          body: string
          can_delete: boolean
          can_edit: boolean
          can_moderate_anonymous: boolean
          comment_id: string
          created_at: string
          depth: number
          edited_at: string
          is_author: boolean
          is_deleted: boolean
          is_effective_feed_bump: boolean
          mentions: Json
          my_reaction: Database["public"]["Enums"]["post_reaction"]
          parent_author_label: string
          parent_comment_id: string
          post_id: string
          reaction_count: number
          reply_count: number
          root_comment_id: string
          top_reactions: Database["public"]["Enums"]["post_reaction"][]
        }[]
      }
    }
    Enums: {
      app_role: "member" | "admin"
      comment_image_status: "pending" | "finalized" | "ready" | "deleted"
      conversation_notification_level: "all" | "mentions" | "off"
      conversation_type: "direct" | "group"
      group_identity_policy: "identified" | "optional_anonymous"
      group_join_policy: "open" | "request" | "invite_only"
      group_kind: "official" | "unofficial"
      group_media_slot: "icon" | "cover"
      group_media_status: "pending" | "ready" | "deleted"
      group_member_role: "owner" | "admin" | "manager" | "member"
      group_notification_level: "none" | "direct" | "all"
      group_post_report_reason:
        "abuse" | "sexual" | "privacy" | "impersonation" | "spam" | "other"
      group_posting_policy: "members" | "staff"
      notification_actor_identity:
        "identified" | "anonymous" | "staff" | "system"
      notification_category:
        "content" | "timeline" | "group" | "account" | "school" | "moderation"
      notification_importance: "low" | "normal" | "high"
      notification_kind:
        | "post_commented"
        | "comment_replied"
        | "post_reacted"
        | "comment_reacted"
        | "timeline_posted"
        | "timeline_post_deleted"
        | "group_posted"
        | "group_join_requested"
        | "group_join_approved"
        | "group_join_rejected"
        | "group_role_changed"
        | "group_ownership_transferred"
        | "official_group_joined"
        | "group_policy_changed"
        | "group_deleted"
        | "post_moderated"
        | "comment_moderated"
        | "anonymous_activity_restricted"
        | "application_submitted"
        | "account_approved"
        | "account_blocked"
        | "account_unblocked"
        | "app_admin_granted"
        | "app_admin_revoked"
        | "gongang_manager_granted"
        | "gongang_manager_revoked"
        | "gongang_preempted"
        | "post_mentioned"
        | "comment_mentioned"
      post_attachment_status: "pending" | "ready" | "deleted"
      post_identity: "identified" | "anonymous" | "staff"
      post_kind: "group" | "profile"
      post_reaction: "like" | "love" | "haha" | "wow" | "sad" | "angry"
      post_visibility: "public" | "private"
      profile_academic_track: "domestic" | "international"
      profile_gender: "male" | "female"
      profile_media_activity_kind: "avatar_changed" | "cover_changed"
      profile_media_slot: "avatar" | "cover"
      profile_media_status: "pending" | "ready"
      profile_status: "draft" | "pending" | "accepted" | "blocked" | "withdrawn"
      profile_type: "student" | "alumni" | "teacher"
      story_audience: "everyone" | "students" | "cohort"
      story_status: "pending" | "ready"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["member", "admin"],
      comment_image_status: ["pending", "finalized", "ready", "deleted"],
      conversation_notification_level: ["all", "mentions", "off"],
      conversation_type: ["direct", "group"],
      group_identity_policy: ["identified", "optional_anonymous"],
      group_join_policy: ["open", "request", "invite_only"],
      group_kind: ["official", "unofficial"],
      group_media_slot: ["icon", "cover"],
      group_media_status: ["pending", "ready", "deleted"],
      group_member_role: ["owner", "admin", "manager", "member"],
      group_notification_level: ["none", "direct", "all"],
      group_post_report_reason: [
        "abuse",
        "sexual",
        "privacy",
        "impersonation",
        "spam",
        "other",
      ],
      group_posting_policy: ["members", "staff"],
      notification_actor_identity: [
        "identified",
        "anonymous",
        "staff",
        "system",
      ],
      notification_category: [
        "content",
        "timeline",
        "group",
        "account",
        "school",
        "moderation",
      ],
      notification_importance: ["low", "normal", "high"],
      notification_kind: [
        "post_commented",
        "comment_replied",
        "post_reacted",
        "comment_reacted",
        "timeline_posted",
        "timeline_post_deleted",
        "group_posted",
        "group_join_requested",
        "group_join_approved",
        "group_join_rejected",
        "group_role_changed",
        "group_ownership_transferred",
        "official_group_joined",
        "group_policy_changed",
        "group_deleted",
        "post_moderated",
        "comment_moderated",
        "anonymous_activity_restricted",
        "application_submitted",
        "account_approved",
        "account_blocked",
        "account_unblocked",
        "app_admin_granted",
        "app_admin_revoked",
        "gongang_manager_granted",
        "gongang_manager_revoked",
        "gongang_preempted",
        "post_mentioned",
        "comment_mentioned",
      ],
      post_attachment_status: ["pending", "ready", "deleted"],
      post_identity: ["identified", "anonymous", "staff"],
      post_kind: ["group", "profile"],
      post_reaction: ["like", "love", "haha", "wow", "sad", "angry"],
      post_visibility: ["public", "private"],
      profile_academic_track: ["domestic", "international"],
      profile_gender: ["male", "female"],
      profile_media_activity_kind: ["avatar_changed", "cover_changed"],
      profile_media_slot: ["avatar", "cover"],
      profile_media_status: ["pending", "ready"],
      profile_status: ["draft", "pending", "accepted", "blocked", "withdrawn"],
      profile_type: ["student", "alumni", "teacher"],
      story_audience: ["everyone", "students", "cohort"],
      story_status: ["pending", "ready"],
    },
  },
} as const
