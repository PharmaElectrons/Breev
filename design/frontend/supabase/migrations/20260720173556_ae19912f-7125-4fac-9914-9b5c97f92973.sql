
-- Employees: HR & payroll fields
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shift_hours numeric NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS check_in text,
  ADD COLUMN IF NOT EXISTS check_out text,
  ADD COLUMN IF NOT EXISTS actual_worked numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS password text,
  ADD COLUMN IF NOT EXISTS role_key text;

-- Accounts: unified chart of accounts fields
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS default_discount_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS due_period_days integer NOT NULL DEFAULT 30;

-- Medicines: highlight color per item
ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS highlight_color text;

-- Custom roles (RBAC)
CREATE TABLE IF NOT EXISTS public.custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_roles TO authenticated;
GRANT ALL ON public.custom_roles TO service_role;
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff access custom_roles" ON public.custom_roles
  FOR ALL TO authenticated
  USING (private.is_staff(auth.uid()))
  WITH CHECK (private.is_staff(auth.uid()));

CREATE TRIGGER custom_roles_touch BEFORE UPDATE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed default roles
INSERT INTO public.custom_roles (key, label, permissions, is_system) VALUES
  ('presence', 'تواجد', ARRAY['sales_invoice']::text[], true),
  ('accountant', 'محاسب', ARRAY['sales_invoice','accounts','reports']::text[], true),
  ('manager', 'مدير', ARRAY['sales_invoice','purchase_invoice','accounts','reports','health_profile','inventory','employees','settings','integration','messages','cart','dashboard']::text[], true),
  ('supervisor', 'مسؤول', ARRAY['sales_invoice','purchase_invoice','inventory','reports']::text[], true),
  ('data_entry', 'مسؤول ادخال', ARRAY['sales_invoice','purchase_invoice']::text[], true),
  ('inventory_auditor', 'مسؤول جرد', ARRAY['inventory','reports']::text[], true)
ON CONFLICT (key) DO NOTHING;
