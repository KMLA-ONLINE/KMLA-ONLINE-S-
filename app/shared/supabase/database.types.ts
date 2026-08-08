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
      profile_academic_track: ["domestic", "international"],
      profile_gender: ["male", "female"],
      profile_status: ["pending", "accepted", "rejected", "withdrawn"],
      profile_type: ["student", "alumni", "teacher"],
    },
  },
} as const

