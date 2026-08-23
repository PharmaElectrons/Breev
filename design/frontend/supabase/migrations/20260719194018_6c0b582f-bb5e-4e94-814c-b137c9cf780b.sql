
-- 1. Remove permissive "auth write" policies that let ANY authenticated user
--    bypass the staff-only restriction on sensitive tables.
DROP POLICY IF EXISTS "auth write medicines" ON public.medicines;
DROP POLICY IF EXISTS "auth write patients" ON public.patients;
DROP POLICY IF EXISTS "auth write purchase_invoices" ON public.purchase_invoices;
DROP POLICY IF EXISTS "auth write purchase_invoice_items" ON public.purchase_invoice_items;
DROP POLICY IF EXISTS "auth write sales_invoices" ON public.sales_invoices;
DROP POLICY IF EXISTS "auth write sales_invoice_items" ON public.sales_invoice_items;
DROP POLICY IF EXISTS "auth write stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "auth write suppliers" ON public.suppliers;

-- 2. Move SECURITY DEFINER helpers out of the API-exposed `public` schema
--    into a private schema so they cannot be invoked via PostgREST / RPC
--    by anon or authenticated users. Existing RLS policies keep working
--    because Postgres stores function references by OID.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.has_role(uuid, app_role) SET SCHEMA private;
ALTER FUNCTION public.is_staff(uuid) SET SCHEMA private;

-- Lock down execute grants: only postgres/service_role may call directly;
-- RLS invocations continue to work because the executor uses the OID and
-- runs the body with definer privileges.
REVOKE ALL ON FUNCTION private.has_role(uuid, app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_staff(uuid) TO authenticated;

-- 3. The auth trigger function is only invoked from a trigger, never from
--    the API. Revoke all client execute privileges.
REVOKE ALL ON FUNCTION public.handle_new_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user_role() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user_role() FROM authenticated;
