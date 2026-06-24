export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          body: string
          channel: string
          created_at: string
          id: string
          published_at: string
          sms_sent: boolean
          tenant_id: string
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          id?: string
          published_at: string
          sms_sent?: boolean
          tenant_id: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          published_at?: string
          sms_sent?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'announcements_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      assignments: {
        Row: {
          created_at: string
          id: string
          official_id: string
          tenant_id: string
          timeslot_end: string
          timeslot_start: string
          todo: string | null
          workstation: string
        }
        Insert: {
          created_at?: string
          id?: string
          official_id: string
          tenant_id: string
          timeslot_end: string
          timeslot_start: string
          todo?: string | null
          workstation: string
        }
        Update: {
          created_at?: string
          id?: string
          official_id?: string
          tenant_id?: string
          timeslot_end?: string
          timeslot_start?: string
          todo?: string | null
          workstation?: string
        }
        Relationships: [
          {
            foreignKeyName: 'assignments_official_id_fkey'
            columns: ['official_id']
            isOneToOne: false
            referencedRelation: 'officials'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'assignments_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          description: string | null
          end_date: string
          event_type: string
          id: string
          location: string | null
          logo_url: string | null
          name: string
          start_date: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date: string
          event_type: string
          id?: string
          location?: string | null
          logo_url?: string | null
          name: string
          start_date: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string
          event_type?: string
          id?: string
          location?: string | null
          logo_url?: string | null
          name?: string
          start_date?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'events_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      officials: {
        Row: {
          created_at: string
          id: string
          invite_status: string
          name: string
          phone: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          invite_status?: string
          name: string
          phone: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          invite_status?: string
          name?: string
          phone?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'officials_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      participants: {
        Row: {
          bib: string | null
          category: string | null
          created_at: string
          id: string
          name: string
          phone: string
          race_results_url: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          bib?: string | null
          category?: string | null
          created_at?: string
          id?: string
          name: string
          phone: string
          race_results_url?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          bib?: string | null
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string
          race_results_url?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'participants_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          feature_flags: Json
          id: string
          is_active: boolean
          name: string
          slug: string
          tier: string
        }
        Insert: {
          created_at?: string
          feature_flags?: Json
          id?: string
          is_active?: boolean
          name: string
          slug: string
          tier?: string
        }
        Update: {
          created_at?: string
          feature_flags?: Json
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          tier?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: string
          role: string
          tenant_id: string
          user_id: string
        }
        Update: {
          id?: string
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_roles_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: { Args: { p_tenant_id: string }; Returns: string }
      is_system_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
