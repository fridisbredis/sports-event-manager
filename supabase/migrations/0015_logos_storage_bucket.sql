-- Create public storage bucket for event logos
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true);

-- Public read (bucket is public so anyone can fetch URLs)
create policy "logos_public_read"
  on storage.objects for select
  using (bucket_id = 'logos');

-- tenant_admin (or system_admin) can upload to their own tenant folder
-- Path pattern: logos/{tenantId}/{eventId}/{filename}
-- get_user_role() and is_system_admin() are defined in 0002_rls_policies.sql
create policy "logos_tenant_admin_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (
      public.get_user_role((storage.foldername(name))[1]::uuid) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

create policy "logos_tenant_admin_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (
      public.get_user_role((storage.foldername(name))[1]::uuid) = 'tenant_admin'
      or public.is_system_admin()
    )
  );

create policy "logos_tenant_admin_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (
      public.get_user_role((storage.foldername(name))[1]::uuid) = 'tenant_admin'
      or public.is_system_admin()
    )
  );
