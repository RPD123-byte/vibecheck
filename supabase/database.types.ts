export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      llm_inference_job_types: {
        Row: {
          description: string | null
          name: string
        }
        Insert: {
          description?: string | null
          name: string
        }
        Update: {
          description?: string | null
          name?: string
        }
        Relationships: []
      }
      llm_inference_jobs: {
        Row: {
          created_at: string
          definition_version: number
          error_message: string | null
          id: string
          input: Json
          job_type: string
          output: Json | null
          semantic_idempotency_key: string
          status: string
          trigger_run_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          definition_version: number
          error_message?: string | null
          id?: string
          input: Json
          job_type: string
          output?: Json | null
          semantic_idempotency_key: string
          status?: string
          trigger_run_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          definition_version?: number
          error_message?: string | null
          id?: string
          input?: Json
          job_type?: string
          output?: Json | null
          semantic_idempotency_key?: string
          status?: string
          trigger_run_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_inference_jobs_job_type_fkey"
            columns: ["job_type"]
            isOneToOne: false
            referencedRelation: "llm_inference_job_types"
            referencedColumns: ["name"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      attach_llm_inference_trigger_run: {
        Args: { p_job_id: string; p_trigger_run_id: string }
        Returns: {
          created_at: string
          definition_version: number
          error_message: string | null
          id: string
          input: Json
          job_type: string
          output: Json | null
          semantic_idempotency_key: string
          status: string
          trigger_run_id: string | null
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "llm_inference_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_llm_inference_job: {
        Args: { p_job_id: string }
        Returns: {
          created_at: string
          definition_version: number
          error_message: string | null
          id: string
          input: Json
          job_type: string
          output: Json | null
          semantic_idempotency_key: string
          status: string
          trigger_run_id: string | null
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "llm_inference_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_llm_inference_job: {
        Args: { p_claimed_updated_at: string; p_job_id: string; p_output: Json }
        Returns: {
          created_at: string
          definition_version: number
          error_message: string | null
          id: string
          input: Json
          job_type: string
          output: Json | null
          semantic_idempotency_key: string
          status: string
          trigger_run_id: string | null
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "llm_inference_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_or_get_llm_inference_job: {
        Args: {
          p_definition_version: number
          p_input: Json
          p_job_type: string
          p_semantic_idempotency_key: string
          p_user_id?: string
        }
        Returns: {
          created_at: string
          definition_version: number
          error_message: string
          id: string
          input: Json
          job_type: string
          output: Json
          semantic_idempotency_key: string
          status: string
          trigger_run_id: string
          updated_at: string
          user_id: string
          was_created: boolean
        }[]
      }
      fail_llm_inference_job: {
        Args: {
          p_claimed_updated_at?: string
          p_error_message: string
          p_job_id: string
        }
        Returns: {
          created_at: string
          definition_version: number
          error_message: string | null
          id: string
          input: Json
          job_type: string
          output: Json | null
          semantic_idempotency_key: string
          status: string
          trigger_run_id: string | null
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "llm_inference_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      requeue_failed_llm_inference_job: {
        Args: { p_input: Json; p_job_id: string }
        Returns: {
          created_at: string
          definition_version: number
          error_message: string | null
          id: string
          input: Json
          job_type: string
          output: Json | null
          semantic_idempotency_key: string
          status: string
          trigger_run_id: string | null
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "llm_inference_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
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

