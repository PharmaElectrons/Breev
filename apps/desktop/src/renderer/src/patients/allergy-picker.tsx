import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { useCommittedFocus } from "../committed-focus";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";

const ALLERGY_FAMILIES = [
  { value: "Penicillins", en: "Penicillins", ar: "البنسلينات" },
  { value: "Cephalosporins", en: "Cephalosporins", ar: "السيفالوسبورينات" },
  { value: "NSAIDs", en: "NSAIDs", ar: "مضادات الالتهاب غير الستيرويدية" },
  { value: "Sulfa", en: "Sulfa medicines", ar: "أدوية السلفا" },
  { value: "Aspirin", en: "Aspirin", ar: "الأسبرين" },
  { value: "Macrolides", en: "Macrolides", ar: "الماكروليدات" },
  {
    value: "Local anesthetics",
    en: "Local anesthetics",
    ar: "المخدرات الموضعية",
  },
  { value: "Latex", en: "Latex", ar: "اللاتكس" },
  { value: "Food", en: "Food", ar: "الأطعمة" },
  { value: "Environmental", en: "Environmental", ar: "العوامل البيئية" },
] as const;

export function patientAllergyLabel(
  value: string,
  locale: "ar" | "en",
): string {
  const family = ALLERGY_FAMILIES.find((item) => item.value === value);
  if (!family) return value;
  return locale === "ar" ? family.ar : family.en;
}

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
  const [query, setQuery] = useState("");
  const [activeOption, setActiveOption] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const requestCommittedFocus = useCommittedFocus();

  const options = useMemo(() => {
    const search = query.trim().toLocaleLowerCase(locale);
    return ALLERGY_FAMILIES.filter((family) => {
      if (value.includes(family.value)) return false;
      if (!search) return true;
      return [family.en, family.ar].some((label) =>
        label.toLocaleLowerCase(locale).includes(search),
      );
    }).slice(0, 8);
  }, [locale, query, value]);

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setQuery("");
    setDismissed(false);
    setActiveOption(0);
    requestCommittedFocus(() =>
      document.getElementById("input-allergy-search"),
    );
  };

  const remove = (item: string) => {
    onChange(value.filter((allergy) => allergy !== item));
    requestCommittedFocus(() =>
      document.getElementById("input-allergy-search"),
    );
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (!dismissed && options.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
      }
      return;
    }
    if (!dismissed && options.length > 0 && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveOption((current) => (current + 1) % options.length);
      return;
    }
    if (!dismissed && options.length > 0 && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveOption(
        (current) => (current - 1 + options.length) % options.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const active = !dismissed ? options[activeOption] : undefined;
      add(active?.value ?? query);
      return;
    }
    if (event.key.length === 1 || event.key === "Backspace") {
      setDismissed(false);
      setActiveOption(0);
    }
  };

  return (
    <div className="allergy-picker-box" data-testid="allergy-picker">
      <span id="allergy-family-label" className="allergy-family-label">
        {copy.allergyFamilyLabel}
      </span>

      {value.length > 0 && (
        <ul className="allergy-tags-container" aria-label={copy.allergies}>
          {value.map((allergy) => (
            <li key={allergy} className="tag-chip tag-chip-rose">
              <span>{patientAllergyLabel(allergy, locale)}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(allergy)}
                  className="tag-chip-remove"
                  aria-label={`${copy.removeItem} ${patientAllergyLabel(allergy, locale)}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && (
        <>
          <div className="allergy-input-row">
            <input
              id="input-allergy-search"
              data-testid="input-allergy-search"
              role="combobox"
              aria-autocomplete="list"
              aria-labelledby="allergy-family-label"
              aria-controls="allergy-family-options"
              aria-expanded={!dismissed && options.length > 0}
              aria-activedescendant={
                !dismissed && options[activeOption]
                  ? `allergy-option-${activeOption}`
                  : undefined
              }
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setDismissed(false);
                setActiveOption(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={copy.addAllergyPlaceholder}
              className="patient-field-input"
              maxLength={200}
            />
            <button
              type="button"
              data-testid="add-allergy-button"
              disabled={!query.trim()}
              onClick={() => add(query)}
              className="btn-outline allergy-add-button"
              aria-label={copy.addItem}
            >
              +
            </button>
          </div>

          <ul
            id="allergy-family-options"
            className="allergy-options-dropdown"
            role="listbox"
            aria-label={copy.allergyFamilyLabel}
            hidden={dismissed || options.length === 0}
          >
            {options.map((family, index) => (
              <li
                key={family.value}
                id={`allergy-option-${index}`}
                role="option"
                aria-selected={activeOption === index}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => add(family.value)}
                className="allergy-option-item"
              >
                {locale === "ar" ? family.ar : family.en}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
