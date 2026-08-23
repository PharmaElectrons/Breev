
-- Multi-branch inventory support
CREATE TABLE public.branches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "branches_authenticated_all" ON public.branches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.medicine_branch_stocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medicine_id, branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicine_branch_stocks TO authenticated;
GRANT ALL ON public.medicine_branch_stocks TO service_role;
ALTER TABLE public.medicine_branch_stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mbs_authenticated_all" ON public.medicine_branch_stocks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed default branches
INSERT INTO public.branches (name, is_primary) VALUES
  ('الفرع الرئيسي', true),
  ('الفرع الثاني', false),
  ('المخزن المركزي', false)
ON CONFLICT (name) DO NOTHING;
