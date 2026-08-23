ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS is_smoker boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS uses_alcohol boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_allergy boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allergies text[] NOT NULL DEFAULT '{}';