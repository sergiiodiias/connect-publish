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
      activity_logs: {
        Row: {
          action: string
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          metadata: Json
          status: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json
          status?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      auto_comments: {
        Row: {
          attempts: number
          created_at: string
          delay_seconds: number
          error: string | null
          fb_comment_id: string | null
          id: string
          message: string
          post_id: string
          posted_at: string | null
          run_at: string | null
          status: Database["public"]["Enums"]["comment_status"]
          target_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delay_seconds?: number
          error?: string | null
          fb_comment_id?: string | null
          id?: string
          message: string
          post_id: string
          posted_at?: string | null
          run_at?: string | null
          status?: Database["public"]["Enums"]["comment_status"]
          target_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delay_seconds?: number
          error?: string | null
          fb_comment_id?: string | null
          id?: string
          message?: string
          post_id?: string
          posted_at?: string | null
          run_at?: string | null
          status?: Database["public"]["Enums"]["comment_status"]
          target_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_comments_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_pages: {
        Row: {
          access_token: string
          category: string | null
          created_at: string
          fb_page_id: string
          id: string
          is_active: boolean
          last_checked_at: string | null
          name: string
          picture_url: string | null
          token_data_access_expires_at: string | null
          token_debug_error: string | null
          token_expires_at: string | null
          token_last_debugged_at: string | null
          token_last_refreshed_at: string | null
          token_scopes: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          category?: string | null
          created_at?: string
          fb_page_id: string
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          name: string
          picture_url?: string | null
          token_data_access_expires_at?: string | null
          token_debug_error?: string | null
          token_expires_at?: string | null
          token_last_debugged_at?: string | null
          token_last_refreshed_at?: string | null
          token_scopes?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          category?: string | null
          created_at?: string
          fb_page_id?: string
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          name?: string
          picture_url?: string | null
          token_data_access_expires_at?: string | null
          token_debug_error?: string | null
          token_expires_at?: string | null
          token_last_debugged_at?: string | null
          token_last_refreshed_at?: string | null
          token_scopes?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      page_group_members: {
        Row: {
          created_at: string
          group_id: string
          page_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          page_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          page_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "page_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_group_members_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "fb_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      page_groups: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      post_insights: {
        Row: {
          captured_at: string
          comments: number
          created_at: string
          engagement_score: number
          fb_post_id: string
          id: string
          impressions: number | null
          likes: number
          page_id: string
          post_id: string
          post_target_id: string
          raw: Json | null
          reach: number | null
          reactions: number
          shares: number
          snapshot_type: string
          user_id: string
          video_views: number | null
        }
        Insert: {
          captured_at?: string
          comments?: number
          created_at?: string
          engagement_score?: number
          fb_post_id: string
          id?: string
          impressions?: number | null
          likes?: number
          page_id: string
          post_id: string
          post_target_id: string
          raw?: Json | null
          reach?: number | null
          reactions?: number
          shares?: number
          snapshot_type: string
          user_id: string
          video_views?: number | null
        }
        Update: {
          captured_at?: string
          comments?: number
          created_at?: string
          engagement_score?: number
          fb_post_id?: string
          id?: string
          impressions?: number | null
          likes?: number
          page_id?: string
          post_id?: string
          post_target_id?: string
          raw?: Json | null
          reach?: number | null
          reactions?: number
          shares?: number
          snapshot_type?: string
          user_id?: string
          video_views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_insights_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "fb_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_insights_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_insights_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: false
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      post_targets: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          fb_post_id: string | null
          id: string
          last_attempt_at: string | null
          next_retry_at: string | null
          page_id: string
          post_id: string
          published_at: string | null
          status: Database["public"]["Enums"]["target_status"]
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          fb_post_id?: string | null
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          page_id: string
          post_id: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["target_status"]
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          fb_post_id?: string | null
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          page_id?: string
          post_id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["target_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_targets_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "fb_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_targets_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          created_at: string
          error: string | null
          id: string
          link_url: string | null
          media_urls: string[]
          message: string | null
          published_at: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["post_status"]
          tags: string[]
          type: Database["public"]["Enums"]["post_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          link_url?: string | null
          media_urls?: string[]
          message?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          tags?: string[]
          type?: Database["public"]["Enums"]["post_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          link_url?: string | null
          media_urls?: string[]
          message?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          tags?: string[]
          type?: Database["public"]["Enums"]["post_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          fb_app_id: string | null
          fb_app_id_2: string | null
          fb_app_secret: string | null
          fb_app_secret_2: string | null
          fb_app_usage: Json
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          fb_app_id?: string | null
          fb_app_id_2?: string | null
          fb_app_secret?: string | null
          fb_app_secret_2?: string | null
          fb_app_usage?: Json
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          fb_app_id?: string | null
          fb_app_id_2?: string | null
          fb_app_secret?: string | null
          fb_app_secret_2?: string | null
          fb_app_usage?: Json
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      upload_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_count: number
          errors: Json
          id: string
          payload: Json | null
          processed_count: number
          status: string
          success_count: number
          total_count: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_count?: number
          errors?: Json
          id?: string
          payload?: Json | null
          processed_count?: number
          status?: string
          success_count?: number
          total_count?: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_count?: number
          errors?: Json
          id?: string
          payload?: Json | null
          processed_count?: number
          status?: string
          success_count?: number
          total_count?: number
          user_id?: string
        }
        Relationships: []
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_job_counts: {
        Args: {
          p_error_inc: number
          p_job_id: string
          p_processed: number
          p_should_complete: boolean
          p_success_inc: number
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
      comment_status: "pending" | "posted" | "failed" | "publishing"
      post_status:
        | "draft"
        | "scheduled"
        | "publishing"
        | "published"
        | "failed"
        | "partial"
      post_type: "text" | "photo" | "video" | "link"
      target_status:
        | "pending"
        | "publishing"
        | "published"
        | "failed"
        | "missing"
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
      app_role: ["admin", "user"],
      comment_status: ["pending", "posted", "failed", "publishing"],
      post_status: [
        "draft",
        "scheduled",
        "publishing",
        "published",
        "failed",
        "partial",
      ],
      post_type: ["text", "photo", "video", "link"],
      target_status: [
        "pending",
        "publishing",
        "published",
        "failed",
        "missing",
      ],
    },
  },
} as const
