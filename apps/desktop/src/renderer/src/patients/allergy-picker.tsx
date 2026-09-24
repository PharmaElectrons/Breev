import { useState, useMemo } from "react";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";

export const ALLERGY_FAMILIES = [
  "البنسلينات (Penicillins)",
  "السيفالوسبورينات (Cephalosporins)",
  "مضادات الالتهاب غير الستيرويدية (NSAIDs)",
  "السلفا (Sulfa)",
  "الأسبرين (Aspirin)",
  "الماكروليدات (Macrolides)",
  "التخدير الموضعي (Local Anesthetics)",
  "اللاتكس (Latex)",
  "حساسية غذائية (Food)",
  "حبوب اللقاح / الغبار (Environmental)",
];

export interface AllergyPickerProps {
  readonly value: readonly string[];
  readonly onChange: (allergies: string[]) => void;
  readonly disabled?: boolean;
}

export function AllergyPicker({
  value,
  onChange,
  disabled = false,
}: AllergyPickerProps) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];
  const [q, setQ] = useState("");

  const options = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ALLERGY_FAMILIES.filter(
      (o) => !value.includes(o) && (!s || o.toLowerCase().includes(s)),
    );
  }, [q, value]);

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setQ("");
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="allergy-picker-box" data-testid="allergy-picker">
      <span className="allergy-family-label">{copy.allergyFamilyLabel}</span>

      {value.length > 0 && (
        <div className="allergy-tags-container">
          {value.map((allg, idx) => (
            <span key={`${allg}-${idx}`} className="tag-chip tag-chip-rose">
              {allg}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="tag-chip-remove"
                  aria-label={copy.removeItem}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!disabled && (
        <>
          <div className="allergy-input-row">
            <input
              data-testid="input-allergy-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(q);
                }
              }}
              placeholder={copy.addAllergyPlaceholder}
              className="patient-field-input"
              style={{ fontSize: "0.75rem" }}
            />
            <button
              type="button"
              data-testid="add-allergy-button"
              disabled={!q.trim()}
              onClick={() => add(q)}
              className="btn-outline"
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.75rem",
                whiteSpace: "nowrap",
                cursor: q.trim() ? "pointer" : "default",
              }}
            >
              +
            </button>
          </div>

          {options.length > 0 && (
            <div className="allergy-options-dropdown" role="listbox">
              {options.slice(0, 8).map((fam) => (
                <button
                  key={fam}
                  type="button"
                  onClick={() => add(fam)}
                  className="allergy-option-item"
                >
                  {fam}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
