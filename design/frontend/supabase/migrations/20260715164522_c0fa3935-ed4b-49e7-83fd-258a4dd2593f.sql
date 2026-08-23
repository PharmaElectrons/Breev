
-- =========================================================
-- Pharmacy schema — all data shared between authenticated users
-- =========================================================

-- Medicines --------------------------------------------------
CREATE TABLE public.medicines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT,
  scientific_name TEXT NOT NULL,
  trade_name TEXT NOT NULL,
  strength TEXT,
  dosage_form TEXT,
  company TEXT,
  category TEXT,
  purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity_in_stock INTEGER NOT NULL DEFAULT 0,
  minimum_stock INTEGER NOT NULL DEFAULT 0,
  expiry_date DATE,
  batch_number TEXT,
  location TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicines TO authenticated;
GRANT ALL ON public.medicines TO service_role;
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read medicines" ON public.medicines FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write medicines" ON public.medicines FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Patients ---------------------------------------------------
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  age INTEGER,
  height_cm NUMERIC(6,2),
  weight_kg NUMERIC(6,2),
  chronic_diseases TEXT[] NOT NULL DEFAULT '{}',
  chronic_meds TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read patients" ON public.patients FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write patients" ON public.patients FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Suppliers --------------------------------------------------
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read suppliers" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write suppliers" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Sales invoices ---------------------------------------------
CREATE TABLE public.sales_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no BIGSERIAL,
  patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'saved',
  payment_type TEXT NOT NULL DEFAULT 'cash',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  addon NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_invoices TO authenticated;
GRANT ALL ON public.sales_invoices TO service_role;
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sales_invoices" ON public.sales_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write sales_invoices" ON public.sales_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.sales_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  medicine_id UUID NOT NULL REFERENCES public.medicines(id),
  qty INTEGER NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_invoice_items TO authenticated;
GRANT ALL ON public.sales_invoice_items TO service_role;
ALTER TABLE public.sales_invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sales_invoice_items" ON public.sales_invoice_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write sales_invoice_items" ON public.sales_invoice_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Purchase invoices ------------------------------------------
CREATE TABLE public.purchase_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no BIGSERIAL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_invoices TO authenticated;
GRANT ALL ON public.purchase_invoices TO service_role;
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read purchase_invoices" ON public.purchase_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write purchase_invoices" ON public.purchase_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.purchase_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  medicine_id UUID NOT NULL REFERENCES public.medicines(id),
  qty INTEGER NOT NULL,
  unit_cost NUMERIC(14,2) NOT NULL,
  line_total NUMERIC(14,2) NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_invoice_items TO authenticated;
GRANT ALL ON public.purchase_invoice_items TO service_role;
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read purchase_invoice_items" ON public.purchase_invoice_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write purchase_invoice_items" ON public.purchase_invoice_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Stock movements --------------------------------------------
CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read stock_movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write stock_movements" ON public.stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Trigger helpers --------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER medicines_touch BEFORE UPDATE ON public.medicines
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER patients_touch BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.apply_sale_stock()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.medicines SET quantity_in_stock = quantity_in_stock - NEW.qty WHERE id = NEW.medicine_id;
  INSERT INTO public.stock_movements (medicine_id, delta, reason, ref_id) VALUES (NEW.medicine_id, -NEW.qty, 'sale', NEW.invoice_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_invoice_items_stock AFTER INSERT ON public.sales_invoice_items
FOR EACH ROW EXECUTE FUNCTION public.apply_sale_stock();

CREATE OR REPLACE FUNCTION public.apply_purchase_stock()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.medicines SET quantity_in_stock = quantity_in_stock + NEW.qty WHERE id = NEW.medicine_id;
  INSERT INTO public.stock_movements (medicine_id, delta, reason, ref_id) VALUES (NEW.medicine_id, NEW.qty, 'purchase', NEW.invoice_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_invoice_items_stock AFTER INSERT ON public.purchase_invoice_items
FOR EACH ROW EXECUTE FUNCTION public.apply_purchase_stock();

-- Alerts views (initial, will be replaced with security_invoker later) -----
CREATE OR REPLACE VIEW public.low_stock_medicines AS
  SELECT * FROM public.medicines WHERE is_active = TRUE AND quantity_in_stock <= minimum_stock;
GRANT SELECT ON public.low_stock_medicines TO authenticated;

CREATE OR REPLACE VIEW public.expiring_medicines AS
  SELECT * FROM public.medicines WHERE is_active = TRUE AND expiry_date IS NOT NULL
     AND expiry_date <= (CURRENT_DATE + INTERVAL '90 days');
GRANT SELECT ON public.expiring_medicines TO authenticated;

CREATE INDEX idx_medicines_trade ON public.medicines (trade_name);
CREATE INDEX idx_medicines_barcode ON public.medicines (barcode);
CREATE INDEX idx_patients_phone ON public.patients (phone);
CREATE INDEX idx_patients_name ON public.patients (full_name);
CREATE INDEX idx_sales_created ON public.sales_invoices (created_at DESC);
CREATE INDEX idx_purchases_created ON public.purchase_invoices (created_at DESC);

ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS large_unit_name text,
  ADD COLUMN IF NOT EXISTS large_unit_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS small_unit_name text,
  ADD COLUMN IF NOT EXISTS units_per_large integer NOT NULL DEFAULT 1;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS large_unit_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS small_unit_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS small_unit_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maximum_stock integer NOT NULL DEFAULT 0;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'auth write%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', r.policyname, r.tablename);
  END LOOP;
END $$;

DROP VIEW IF EXISTS public.low_stock_medicines;
CREATE VIEW public.low_stock_medicines WITH (security_invoker = on) AS
  SELECT * FROM public.medicines WHERE is_active = true AND quantity_in_stock <= minimum_stock;

DROP VIEW IF EXISTS public.expiring_medicines;
CREATE VIEW public.expiring_medicines WITH (security_invoker = on) AS
  SELECT * FROM public.medicines WHERE is_active = true AND expiry_date IS NOT NULL AND expiry_date <= (CURRENT_DATE + INTERVAL '90 days');

GRANT SELECT ON public.low_stock_medicines TO authenticated;
GRANT SELECT ON public.expiring_medicines TO authenticated;

-- Employees ------------------------------------------------------------
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, phone text, shift text,
  salary numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY employees_all_auth ON public.employees FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE TRIGGER employees_touch BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'cashier',
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO authenticated;
GRANT ALL ON public.app_users TO service_role;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_users_all_auth ON public.app_users FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE TRIGGER app_users_touch BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.patient_extras (
  patient_id uuid PRIMARY KEY REFERENCES public.patients(id) ON DELETE CASCADE,
  dob date, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_extras TO authenticated;
GRANT ALL ON public.patient_extras TO service_role;
ALTER TABLE public.patient_extras ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_extras_all_auth ON public.patient_extras FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE TRIGGER patient_extras_touch BEFORE UPDATE ON public.patient_extras FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.patient_weight_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT CURRENT_DATE,
  kg numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_weight_logs_patient_idx ON public.patient_weight_logs(patient_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_weight_logs TO authenticated;
GRANT ALL ON public.patient_weight_logs TO service_role;
ALTER TABLE public.patient_weight_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_weight_logs_all_auth ON public.patient_weight_logs FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.patient_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor text NOT NULL DEFAULT '', specialty text,
  visit_date date NOT NULL DEFAULT CURRENT_DATE,
  diagnosis text NOT NULL DEFAULT '',
  prescribed text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_visits_patient_idx ON public.patient_visits(patient_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_visits TO authenticated;
GRANT ALL ON public.patient_visits TO service_role;
ALTER TABLE public.patient_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_visits_all_auth ON public.patient_visits FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.patient_labs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  test text NOT NULL,
  lab_date date NOT NULL DEFAULT CURRENT_DATE,
  value_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_labs_patient_idx ON public.patient_labs(patient_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_labs TO authenticated;
GRANT ALL ON public.patient_labs TO service_role;
ALTER TABLE public.patient_labs ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_labs_all_auth ON public.patient_labs FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.patient_pharmacy_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  item text NOT NULL,
  first_purchase date NOT NULL DEFAULT CURRENT_DATE,
  last_purchase date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_pharmacy_history_patient_idx ON public.patient_pharmacy_history(patient_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_pharmacy_history TO authenticated;
GRANT ALL ON public.patient_pharmacy_history TO service_role;
ALTER TABLE public.patient_pharmacy_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_pharmacy_history_all_auth ON public.patient_pharmacy_history FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.patient_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  patient_name text NOT NULL, patient_phone text,
  medicine_id uuid NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  medicine_name text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
CREATE INDEX patient_reservations_patient_idx ON public.patient_reservations(patient_id);
CREATE INDEX patient_reservations_medicine_idx ON public.patient_reservations(medicine_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_reservations TO authenticated;
GRANT ALL ON public.patient_reservations TO service_role;
ALTER TABLE public.patient_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_reservations_all_auth ON public.patient_reservations FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.chronic_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  patient_name text NOT NULL, patient_phone text,
  medicine_id uuid NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  medicine_name text NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  days_per_cycle integer NOT NULL DEFAULT 30,
  reorder_alerted boolean NOT NULL DEFAULT false,
  patient_notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chronic_schedule_patient_idx ON public.chronic_schedule(patient_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chronic_schedule TO authenticated;
GRANT ALL ON public.chronic_schedule TO service_role;
ALTER TABLE public.chronic_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY chronic_schedule_all_auth ON public.chronic_schedule FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'supplier',
  opening_balance numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounts_all_auth ON public.accounts FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE TRIGGER accounts_touch BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.account_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  entry_type text NOT NULL DEFAULT 'receipt',
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD',
  exchange_rate numeric NOT NULL DEFAULT 1,
  iqd_equivalent numeric NOT NULL DEFAULT 0,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_entries_account_idx ON public.account_entries(account_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_entries TO authenticated;
GRANT ALL ON public.account_entries TO service_role;
ALTER TABLE public.account_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_entries_all_auth ON public.account_entries FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  phone text,
  channel text NOT NULL DEFAULT 'wa',
  body text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_log_patient_idx ON public.message_log(patient_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_log TO authenticated;
GRANT ALL ON public.message_log TO service_role;
ALTER TABLE public.message_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_log_all_auth ON public.message_log FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Additive columns
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS tax numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'saved',
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS suppliers_touch ON public.suppliers;
CREATE TRIGGER suppliers_touch BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS sales_invoices_touch ON public.sales_invoices;
CREATE TRIGGER sales_invoices_touch BEFORE UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS purchase_invoices_touch ON public.purchase_invoices;
CREATE TRIGGER purchase_invoices_touch BEFORE UPDATE ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS medicines_barcode_unique ON public.medicines (barcode) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_unique ON public.suppliers (lower(name));

CREATE INDEX IF NOT EXISTS idx_medicines_trade_name       ON public.medicines (lower(trade_name));
CREATE INDEX IF NOT EXISTS idx_medicines_scientific_name  ON public.medicines (lower(scientific_name));
CREATE INDEX IF NOT EXISTS idx_medicines_barcode          ON public.medicines (barcode);
CREATE INDEX IF NOT EXISTS idx_patients_full_name         ON public.patients  (lower(full_name));
CREATE INDEX IF NOT EXISTS idx_patients_phone             ON public.patients  (phone);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_no           ON public.sales_invoices    (invoice_no);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_no        ON public.purchase_invoices (invoice_no);
CREATE INDEX IF NOT EXISTS idx_suppliers_name             ON public.suppliers (lower(name));
CREATE INDEX IF NOT EXISTS idx_sales_items_invoice        ON public.sales_invoice_items    (invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_medicine       ON public.sales_invoice_items    (medicine_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_invoice     ON public.purchase_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_medicine    ON public.purchase_invoice_items (medicine_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_medicine   ON public.stock_movements (medicine_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_negative_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.quantity_in_stock < 0 THEN
    RAISE EXCEPTION 'المخزون لا يمكن أن يكون سالباً للدواء %', NEW.trade_name USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS medicines_no_negative_stock ON public.medicines;
CREATE TRIGGER medicines_no_negative_stock BEFORE INSERT OR UPDATE OF quantity_in_stock ON public.medicines FOR EACH ROW EXECUTE FUNCTION public.prevent_negative_stock();

CREATE OR REPLACE FUNCTION public.revert_sale_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.medicines SET quantity_in_stock = quantity_in_stock + OLD.qty WHERE id = OLD.medicine_id;
  INSERT INTO public.stock_movements (medicine_id, delta, reason, ref_id) VALUES (OLD.medicine_id, OLD.qty, 'sale_reverted', OLD.invoice_id);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS sales_items_revert ON public.sales_invoice_items;
CREATE TRIGGER sales_items_revert AFTER DELETE ON public.sales_invoice_items FOR EACH ROW EXECUTE FUNCTION public.revert_sale_stock();

CREATE OR REPLACE FUNCTION public.revert_purchase_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.medicines SET quantity_in_stock = GREATEST(0, quantity_in_stock - OLD.qty) WHERE id = OLD.medicine_id;
  INSERT INTO public.stock_movements (medicine_id, delta, reason, ref_id) VALUES (OLD.medicine_id, -OLD.qty, 'purchase_reverted', OLD.invoice_id);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS purchase_items_revert ON public.purchase_invoice_items;
CREATE TRIGGER purchase_items_revert AFTER DELETE ON public.purchase_invoice_items FOR EACH ROW EXECUTE FUNCTION public.revert_purchase_stock();

CREATE OR REPLACE FUNCTION public.sync_sales_invoice_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE inv_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id); new_sub numeric;
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO new_sub FROM public.sales_invoice_items WHERE invoice_id = inv_id;
  UPDATE public.sales_invoices SET subtotal = new_sub, total = GREATEST(0, new_sub + addon + tax - discount) WHERE id = inv_id;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS sales_items_sync_total ON public.sales_invoice_items;
CREATE TRIGGER sales_items_sync_total AFTER INSERT OR UPDATE OR DELETE ON public.sales_invoice_items FOR EACH ROW EXECUTE FUNCTION public.sync_sales_invoice_total();

CREATE OR REPLACE FUNCTION public.sync_purchase_invoice_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE inv_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id); new_sub numeric;
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO new_sub FROM public.purchase_invoice_items WHERE invoice_id = inv_id;
  UPDATE public.purchase_invoices SET subtotal = new_sub, total = GREATEST(0, new_sub + tax - discount) WHERE id = inv_id;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS purchase_items_sync_total ON public.purchase_invoice_items;
CREATE TRIGGER purchase_items_sync_total AFTER INSERT OR UPDATE OR DELETE ON public.purchase_invoice_items FOR EACH ROW EXECUTE FUNCTION public.sync_purchase_invoice_total();

CREATE TABLE IF NOT EXISTS public.pharmacy_settings (
  key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pharmacy_settings TO authenticated;
GRANT ALL ON public.pharmacy_settings TO service_role;
ALTER TABLE public.pharmacy_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all pharmacy_settings" ON public.pharmacy_settings;
CREATE POLICY "auth all pharmacy_settings" ON public.pharmacy_settings FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP TRIGGER IF EXISTS pharmacy_settings_touch ON public.pharmacy_settings;
CREATE TRIGGER pharmacy_settings_touch BEFORE UPDATE ON public.pharmacy_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.medicine_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE, description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicine_categories TO authenticated;
GRANT ALL ON public.medicine_categories TO service_role;
ALTER TABLE public.medicine_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all medicine_categories" ON public.medicine_categories;
CREATE POLICY "auth all medicine_categories" ON public.medicine_categories FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP TRIGGER IF EXISTS medicine_categories_touch ON public.medicine_categories;
CREATE TRIGGER medicine_categories_touch BEFORE UPDATE ON public.medicine_categories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, phone text, email text, address text, notes text,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.customers (lower(name));
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers (phone);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all customers" ON public.customers;
CREATE POLICY "auth all customers" ON public.customers FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP TRIGGER IF EXISTS customers_touch ON public.customers;
CREATE TRIGGER customers_touch BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_customer_id_fkey') THEN
    ALTER TABLE public.sales_invoices ADD CONSTRAINT sales_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_employee_id_fkey') THEN
    ALTER TABLE public.sales_invoices ADD CONSTRAINT sales_invoices_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoices_employee_id_fkey') THEN
    ALTER TABLE public.purchase_invoices ADD CONSTRAINT purchase_invoices_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_user_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON public.user_permissions (app_user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all user_permissions" ON public.user_permissions;
CREATE POLICY "auth all user_permissions" ON public.user_permissions FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_unique ON public.app_users (lower(username));

CREATE TABLE IF NOT EXISTS public.medicine_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id uuid NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  expiry_date date,
  purchase_price numeric(14,2) NOT NULL DEFAULT 0,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  received_at date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (medicine_id, batch_number)
);
CREATE INDEX IF NOT EXISTS idx_batches_medicine ON public.medicine_batches (medicine_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry   ON public.medicine_batches (expiry_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicine_batches TO authenticated;
GRANT ALL ON public.medicine_batches TO service_role;
ALTER TABLE public.medicine_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all medicine_batches" ON public.medicine_batches;
CREATE POLICY "auth all medicine_batches" ON public.medicine_batches FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP TRIGGER IF EXISTS medicine_batches_touch ON public.medicine_batches;
CREATE TRIGGER medicine_batches_touch BEFORE UPDATE ON public.medicine_batches FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor text, specialty text, diagnosis text, notes text,
  issued_at date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON public.prescriptions (patient_id, issued_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prescriptions TO authenticated;
GRANT ALL ON public.prescriptions TO service_role;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all prescriptions" ON public.prescriptions;
CREATE POLICY "auth all prescriptions" ON public.prescriptions FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP TRIGGER IF EXISTS prescriptions_touch ON public.prescriptions;
CREATE TRIGGER prescriptions_touch BEFORE UPDATE ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.prescription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  medicine_id uuid REFERENCES public.medicines(id) ON DELETE SET NULL,
  medicine_name text NOT NULL,
  dose text, frequency text, duration_days integer,
  qty integer NOT NULL DEFAULT 1, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prescription_items_rx ON public.prescription_items (prescription_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prescription_items TO authenticated;
GRANT ALL ON public.prescription_items TO service_role;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all prescription_items" ON public.prescription_items;
CREATE POLICY "auth all prescription_items" ON public.prescription_items FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.patient_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  file_name text NOT NULL, file_path text NOT NULL,
  mime_type text, size_bytes bigint, category text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patient_files_patient ON public.patient_files (patient_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_files TO authenticated;
GRANT ALL ON public.patient_files TO service_role;
ALTER TABLE public.patient_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all patient_files" ON public.patient_files;
CREATE POLICY "auth all patient_files" ON public.patient_files FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.account_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  entry_type text NOT NULL DEFAULT 'receipt' CHECK (entry_type IN ('receipt','payment','transfer','adjustment')),
  amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD',
  exchange_rate numeric(14,4) NOT NULL DEFAULT 1,
  iqd_equivalent numeric(14,2) NOT NULL DEFAULT 0,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  reference text, description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_tx_account ON public.account_transactions (account_id, entry_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_transactions TO authenticated;
GRANT ALL ON public.account_transactions TO service_role;
ALTER TABLE public.account_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all account_transactions" ON public.account_transactions;
CREATE POLICY "auth all account_transactions" ON public.account_transactions FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD',
  description text, paid_to text,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses (expense_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all expenses" ON public.expenses;
CREATE POLICY "auth all expenses" ON public.expenses FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.income (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD',
  description text,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  income_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_income_date ON public.income (income_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.income TO authenticated;
GRANT ALL ON public.income TO service_role;
ALTER TABLE public.income ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all income" ON public.income;
CREATE POLICY "auth all income" ON public.income FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  phone text,
  channel text NOT NULL DEFAULT 'wa' CHECK (channel IN ('wa','tg','sms','email')),
  subject text, body text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_message_logs_patient ON public.message_logs (patient_id, sent_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_logs TO authenticated;
GRANT ALL ON public.message_logs TO service_role;
ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all message_logs" ON public.message_logs;
CREATE POLICY "auth all message_logs" ON public.message_logs FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, body text,
  kind text NOT NULL DEFAULT 'info' CHECK (kind IN ('info','warning','error','success')),
  target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ref_table text, ref_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (target_user_id, is_read, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all notifications" ON public.notifications;
CREATE POLICY "auth all notifications" ON public.notifications FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.invoice_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_kind text NOT NULL CHECK (invoice_kind IN ('sale','purchase')),
  sales_invoice_id uuid REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  purchase_invoice_id uuid REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (invoice_kind = 'sale' AND sales_invoice_id IS NOT NULL AND purchase_invoice_id IS NULL) OR
    (invoice_kind = 'purchase' AND purchase_invoice_id IS NOT NULL AND sales_invoice_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_invoice_comments_sales    ON public.invoice_comments (sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_comments_purchase ON public.invoice_comments (purchase_invoice_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_comments TO authenticated;
GRANT ALL ON public.invoice_comments TO service_role;
ALTER TABLE public.invoice_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all invoice_comments" ON public.invoice_comments;
CREATE POLICY "auth all invoice_comments" ON public.invoice_comments FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text, entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor  ON public.activity_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON public.activity_logs (entity_type, entity_id);
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read activity_logs" ON public.activity_logs;
CREATE POLICY "auth read activity_logs" ON public.activity_logs FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "auth insert activity_logs" ON public.activity_logs;
CREATE POLICY "auth insert activity_logs" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL, row_id uuid,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  actor_id uuid, old_data jsonb, new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON public.audit_logs (table_name, created_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read audit_logs" ON public.audit_logs;
CREATE POLICY "auth read audit_logs" ON public.audit_logs FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "auth insert audit_logs" ON public.audit_logs;
CREATE POLICY "auth insert audit_logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE VIEW public.daily_sales WITH (security_invoker = on) AS
SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
  COUNT(*) AS invoice_count, SUM(subtotal) AS subtotal,
  SUM(discount) AS discount, SUM(addon) AS addon,
  SUM(tax) AS tax, SUM(total) AS total
FROM public.sales_invoices WHERE status = 'saved' GROUP BY 1 ORDER BY 1 DESC;

CREATE OR REPLACE VIEW public.monthly_sales WITH (security_invoker = on) AS
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
  COUNT(*) AS invoice_count, SUM(subtotal) AS subtotal,
  SUM(discount) AS discount, SUM(addon) AS addon,
  SUM(tax) AS tax, SUM(total) AS total
FROM public.sales_invoices WHERE status = 'saved' GROUP BY 1 ORDER BY 1 DESC;

CREATE OR REPLACE VIEW public.top_selling_medicines WITH (security_invoker = on) AS
SELECT m.id, m.trade_name, m.scientific_name,
  COALESCE(SUM(sii.qty), 0) AS total_qty,
  COALESCE(SUM(sii.line_total), 0) AS total_revenue,
  COUNT(DISTINCT sii.invoice_id) AS invoice_count
FROM public.medicines m
LEFT JOIN public.sales_invoice_items sii ON sii.medicine_id = m.id
LEFT JOIN public.sales_invoices si ON si.id = sii.invoice_id AND si.status = 'saved'
GROUP BY m.id, m.trade_name, m.scientific_name
ORDER BY total_qty DESC;

CREATE OR REPLACE VIEW public.inventory_summary WITH (security_invoker = on) AS
SELECT COUNT(*) AS total_items,
  COALESCE(SUM(quantity_in_stock), 0) AS total_units,
  COALESCE(SUM(quantity_in_stock * small_unit_cost), 0) AS total_value_cost,
  COALESCE(SUM(quantity_in_stock * small_unit_price), 0) AS total_value_retail,
  COUNT(*) FILTER (WHERE quantity_in_stock <= minimum_stock) AS low_stock_count,
  COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '90 days') AS expiring_count,
  COUNT(*) FILTER (WHERE quantity_in_stock = 0) AS out_of_stock_count
FROM public.medicines WHERE is_active = true;

ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS wholesale_large_price numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wholesale_small_price numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_price numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_per_cycle integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.apply_purchase_stock()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE old_qty integer; old_cost numeric; new_avg numeric;
BEGIN
  SELECT quantity_in_stock, small_unit_cost INTO old_qty, old_cost
    FROM public.medicines WHERE id = NEW.medicine_id FOR UPDATE;
  IF (old_qty + NEW.qty) > 0 AND NEW.unit_cost > 0 THEN
    new_avg := ((GREATEST(old_qty,0) * COALESCE(old_cost,0)) + (NEW.qty * NEW.unit_cost)) / (GREATEST(old_qty,0) + NEW.qty);
  ELSE
    new_avg := old_cost;
  END IF;
  UPDATE public.medicines
     SET quantity_in_stock = quantity_in_stock + NEW.qty,
         small_unit_cost = COALESCE(new_avg, small_unit_cost),
         purchase_price = COALESCE(new_avg, purchase_price)
   WHERE id = NEW.medicine_id;
  INSERT INTO public.stock_movements (medicine_id, delta, reason, ref_id)
  VALUES (NEW.medicine_id, NEW.qty, 'purchase', NEW.invoice_id);
  RETURN NEW;
END;
$function$;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('staff','admin'));
$$;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'staff'::public.app_role FROM auth.users ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users ORDER BY created_at ASC LIMIT 1 ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'staff') ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

DROP POLICY IF EXISTS "auth all app_users" ON public.app_users;
DROP POLICY IF EXISTS "app_users_all_auth" ON public.app_users;
DROP POLICY IF EXISTS "admins manage app_users" ON public.app_users;
CREATE POLICY "admins manage app_users" ON public.app_users FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients','patient_labs','patient_files','patient_visits','patient_extras',
    'patient_pharmacy_history','patient_reservations','patient_weight_logs',
    'prescriptions','prescription_items','chronic_schedule',
    'customers','suppliers','employees',
    'accounts','account_entries','account_transactions',
    'income','expenses',
    'sales_invoices','sales_invoice_items',
    'purchase_invoices','purchase_invoice_items',
    'invoice_comments','stock_movements',
    'medicines','medicine_batches','medicine_categories',
    'message_log','message_logs','notifications',
    'activity_logs','audit_logs','user_permissions','pharmacy_settings'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth all '||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_all_auth', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth read '||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth insert '||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff access '||t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))',
      'staff access '||t, t
    );
  END LOOP;
END $$;
