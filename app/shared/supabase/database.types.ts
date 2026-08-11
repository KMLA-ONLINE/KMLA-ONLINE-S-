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
      group_join_requests: {
        Row: {
          group_id: string
          profile_id: number
          requested_at: string
        }
        Insert: {
          group_id: string
          profile_id: number
          requested_at?: string
        }
        Update: {
          group_id?: string
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
      group_memberships: {
        Row: {
          group_id: string
          joined_at: string
          pinned_at: string | null
          profile_id: number
          role: Database["public"]["Enums"]["group_member_role"]
        }
        Insert: {
          group_id: string
          joined_at?: string
          pinned_at?: string | null
          profile_id: number
          role?: Database["public"]["Enums"]["group_member_role"]
        }
        Update: {
          group_id?: string
          joined_at?: string
          pinned_at?: string | null
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
        Insert: {
          cover_path?: string | null
          created_at?: string
          created_by: number
          description?: string
          icon_path?: string | null
          id?: string
          identity_policy: Database["public"]["Enums"]["group_identity_policy"]
          join_policy: Database["public"]["Enums"]["group_join_policy"]
          kind: Database["public"]["Enums"]["group_kind"]
          member_count?: number
          name: string
          posting_policy: Database["public"]["Enums"]["group_posting_policy"]
          search_name?: string | null
          slug: string
          slug_is_custom?: boolean
          updated_at?: string
        }
        Update: {
          cover_path?: string | null
          created_at?: string
          created_by?: number
          description?: string
          icon_path?: string | null
          id?: string
          identity_policy?: Database["public"]["Enums"]["group_identity_policy"]
          join_policy?: Database["public"]["Enums"]["group_join_policy"]
          kind?: Database["public"]["Enums"]["group_kind"]
          member_count?: number
          name?: string
          posting_policy?: Database["public"]["Enums"]["group_posting_policy"]
          search_name?: string | null
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
      profiles: {
        Row: {
          academic_track:
            | Database["public"]["Enums"]["profile_academic_track"]
            | null
          anonymous_username: string | null
          auth_user_id: string | null
          avatar_path: string | null
          birthday: string | null
          class_no: number | null
          cohort: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          dorm_room: number | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          id: number
          name: string
          onboarding_completed_at: string
          phone_number: string | null
          pub_id: string
          rejection_reason: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["profile_status"]
          status_updated_at: string
          status_updated_by: number | null
          student_number: string | null
          submitted_at: string
          type: Database["public"]["Enums"]["profile_type"]
          updated_at: string
        }
        Insert: {
          academic_track?:
            | Database["public"]["Enums"]["profile_academic_track"]
            | null
          anonymous_username?: string | null
          auth_user_id?: string | null
          avatar_path?: string | null
          birthday?: string | null
          class_no?: number | null
          cohort?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          dorm_room?: number | null
          gender?: Database["public"]["Enums"]["profile_gender"] | null
          id?: never
          name: string
          onboarding_completed_at?: string
          phone_number?: string | null
          pub_id?: string
          rejection_reason?: string | null
          role?: Database["public"]["Enums"]["app_role"]
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
            | Database["public"]["Enums"]["profile_academic_track"]
            | null
          anonymous_username?: string | null
          auth_user_id?: string | null
          avatar_path?: string | null
          birthday?: string | null
          class_no?: number | null
          cohort?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          dorm_room?: number | null
          gender?: Database["public"]["Enums"]["profile_gender"] | null
          id?: never
          name?: string
          onboarding_completed_at?: string
          phone_number?: string | null
          pub_id?: string
          rejection_reason?: string | null
          role?: Database["public"]["Enums"]["app_role"]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_group: {
        Args: {
          p_description?: string
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
      get_my_profile: {
        Args: never
        Returns: {
          academic_track:
            | Database["public"]["Enums"]["profile_academic_track"]
            | null
          anonymous_username: string | null
          auth_user_id: string | null
          avatar_path: string | null
          birthday: string | null
          class_no: number | null
          cohort: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          dorm_room: number | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          id: number
          name: string
          onboarding_completed_at: string
          phone_number: string | null
          pub_id: string
          rejection_reason: string | null
          role: Database["public"]["Enums"]["app_role"]
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
      list_popular_groups: {
        Args: { p_limit?: number }
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
            | Database["public"]["Enums"]["profile_academic_track"]
            | null
          anonymous_username: string | null
          auth_user_id: string | null
          avatar_path: string | null
          birthday: string | null
          class_no: number | null
          cohort: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          dorm_room: number | null
          gender: Database["public"]["Enums"]["profile_gender"] | null
          id: number
          name: string
          onboarding_completed_at: string
          phone_number: string | null
          pub_id: string
          rejection_reason: string | null
          role: Database["public"]["Enums"]["app_role"]
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
    }
    Enums: {
      app_role: "member" | "admin"
      group_identity_policy:
        | "identified"
        | "optional_anonymous"
        | "always_anonymous"
      group_join_policy: "open" | "request" | "invite_only"
      group_kind: "official" | "unofficial"
      group_member_role: "owner" | "admin" | "manager" | "member"
      group_posting_policy: "members" | "staff"
      profile_academic_track: "domestic" | "international"
      profile_gender: "male" | "female"
      profile_status: "pending" | "accepted" | "rejected" | "withdrawn"
      profile_type: "student" | "alumni" | "teacher"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["member", "admin"],
      group_identity_policy: [
        "identified",
        "optional_anonymous",
        "always_anonymous",
      ],
      group_join_policy: ["open", "request", "invite_only"],
      group_kind: ["official", "unofficial"],
      group_member_role: ["owner", "admin", "manager", "member"],
      group_posting_policy: ["members", "staff"],
      profile_academic_track: ["domestic", "international"],
      profile_gender: ["male", "female"],
      profile_status: ["pending", "accepted", "rejected", "withdrawn"],
      profile_type: ["student", "alumni", "teacher"],
    },
  },
} as const

