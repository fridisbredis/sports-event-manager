-- The tables that make up one tenant's data, and how to select its rows in
-- each: one line per table, "<table>|<filter>". Shared by
-- scripts/ops/diff-tenant.sh (N25 restore preview, run against the restored
-- backup and against live prod) and scripts/check-tenant-table-classification.sh
-- (CI), so the preview and the check can never disagree about what a tenant is.
--
-- Run with: psql -v tenant=<uuid> -At -F'|' -f scripts/ops/tenant-scope.sql
--
-- Which tables:
--   - public.tenants, the tenant's own row;
--   - every public table with a tenant_id column;
--   - every public table WITHOUT tenant_id that has a single-column foreign key
--     to one of those (e.g. workstation_todos -> workstations), filtered
--     through it.
WITH base AS (
  SELECT c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
),
tenant_tables AS (
  SELECT b.relname FROM base b
  JOIN information_schema.columns col
    ON col.table_schema = 'public' AND col.table_name = b.relname AND col.column_name = 'tenant_id'
),
one_hop AS (
  -- Single-column foreign keys from a table without tenant_id to one with it.
  SELECT DISTINCT ON (child.relname)
    child.relname,
    format('%I IN (SELECT %I FROM public.%I WHERE tenant_id = %L)',
           ca.attname, pa.attname, parent.relname, :'tenant') AS filter
  FROM pg_constraint con
  JOIN pg_class child ON child.oid = con.conrelid
  JOIN pg_class parent ON parent.oid = con.confrelid
  JOIN pg_namespace cn ON cn.oid = child.relnamespace AND cn.nspname = 'public'
  JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
  JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
  WHERE con.contype = 'f' AND cardinality(con.conkey) = 1
    AND parent.relname IN (SELECT relname FROM tenant_tables)
    AND child.relname NOT IN (SELECT relname FROM tenant_tables)
    AND child.relname <> 'tenants'
  ORDER BY child.relname, con.conname
)
SELECT 'tenants', format('id = %L', :'tenant')
UNION ALL
SELECT relname, format('tenant_id = %L', :'tenant') FROM tenant_tables
UNION ALL
SELECT relname, filter FROM one_hop
ORDER BY 1;
