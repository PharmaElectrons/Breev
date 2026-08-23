ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS daily_frequency integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS meal_timing text NOT NULL DEFAULT 'any';

ALTER TABLE public.medicines
  ADD CONSTRAINT medicines_meal_timing_check CHECK (meal_timing IN ('before','after','any'));