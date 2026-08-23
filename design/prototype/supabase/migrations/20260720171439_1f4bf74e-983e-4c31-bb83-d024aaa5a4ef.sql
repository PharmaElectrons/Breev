
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS default_discount_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'credit',
  ADD COLUMN IF NOT EXISTS due_period_days integer NOT NULL DEFAULT 30;
