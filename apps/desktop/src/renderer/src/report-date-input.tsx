import { normalizeIndicDigits } from "@breev/contracts/local-rest";
import { useRef, type InputHTMLAttributes } from "react";
import { CalendarDays } from "lucide-react";
import { usePreferences } from "./preferences-provider";
import { reportMessages } from "../../shared/report-messages";

/** Chromium's native date segments discard Indic input before change fires.
 * Arabic entry uses an ISO text control so typed and pasted digits can be normalized.
 * The submitted date/time still passes the same pharmacy-time and contract validation. */
export function ReportDateInput({
  type,
  onChange,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly type: "date" | "datetime-local";
}): React.JSX.Element {
  const { locale } = usePreferences();
  const entry = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const input = (
    <input
      {...props}
      ref={entry}
      type={locale === "ar" ? "text" : type}
      dir="ltr"
      placeholder={type === "date" ? "YYYY-MM-DD" : "YYYY-MM-DDThh:mm:ss"}
      pattern={
        locale === "ar"
          ? type === "date"
            ? "[0-9]{4}-[0-9]{2}-[0-9]{2}"
            : "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,3})?)?"
          : undefined
      }
      onChange={(event) => {
        const input = event.currentTarget;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const normalized = normalizeIndicDigits(input.value);
        if (normalized !== input.value) {
          input.value = normalized;
          if (start !== null && end !== null)
            input.setSelectionRange(start, end);
        }
        onChange?.(event);
      }}
    />
  );
  if (locale === "en") return input;
  return (
    <span className="report-date-entry">
      {input}
      <input
        ref={picker}
        className="report-native-date-picker"
        type={type}
        step={props.step}
        min={props.min}
        max={props.max}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          if (entry.current) entry.current.value = event.currentTarget.value;
          onChange?.(event);
        }}
      />
      <button
        type="button"
        className="report-date-picker-button"
        aria-label={reportMessages[locale].chooseDate}
        disabled={props.disabled || props.readOnly}
        onClick={() => {
          if (!picker.current || !entry.current) return;
          picker.current.value = entry.current.value;
          picker.current.showPicker();
        }}
      >
        <CalendarDays aria-hidden="true" />
      </button>
    </span>
  );
}
