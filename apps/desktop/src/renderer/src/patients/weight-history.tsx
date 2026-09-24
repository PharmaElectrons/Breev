import React, { useState } from "react";
import type {
  PatientProfileResponse,
  PatientWeightMeasurementResponse,
} from "@breev/contracts/local-rest";
import {
  formatCanonicalDecimal,
  isValidPatientWeight,
} from "../lib/exact-decimal";
import { categorizeBmi } from "../lib/patient-bmi";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";
import { addPatientWeight } from "./patient-api";

export function BmiCard({
  patient,
}: {
  readonly patient: Pick<PatientProfileResponse, "bmi" | "heightCm">;
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];

  const bmiVal = patient.bmi ? formatCanonicalDecimal(patient.bmi) : null;
  const bmiCat = patient.bmi ? categorizeBmi(patient.bmi) : null;
  const bmiCatLabel =
    bmiCat && bmiCat !== "unknown" ? copy.bmiCategory(bmiCat) : null;

  return (
    <div className="bmi-card col-span-2">
      <p className="bmi-card-label">{copy.bmi}</p>
      <p className="bmi-card-value" data-testid="view-bmi">
        {bmiVal
          ? `${bmiVal}${bmiCatLabel ? ` (${bmiCatLabel})` : ""}`
          : copy.notSet}
      </p>
      {bmiCatLabel && <p className="bmi-card-category">{bmiCatLabel}</p>}
    </div>
  );
}

export function InlineWeightInput({
  patientId,
  weights,
  onWeightAdded,
  canManage,
}: {
  readonly patientId?: string | undefined;
  readonly weights: readonly PatientWeightMeasurementResponse[];
  readonly onWeightAdded?: (() => Promise<void> | void) | undefined;
  readonly canManage: boolean;
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];

  const [weightKg, setWeightKg] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latestWeight = weights[0]
    ? formatCanonicalDecimal(weights[0].weightKg)
    : null;

  const normalizedWeight = weightKg.trim().replace(",", ".");
  const hasInput = weightKg.trim().length > 0;
  const isInputValid = !hasInput || isValidPatientWeight(normalizedWeight);

  const selectedMeasurement = weights.find((w) => w.id === selectedHistoryId);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!hasInput || !patientId || !canManage) return;

    if (!isValidPatientWeight(normalizedWeight)) {
      setError(copy.invalidWeightFormat);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const abort = new AbortController();
      await addPatientWeight(abort.signal, patientId, {
        weightKg: normalizedWeight,
        measuredAt: new Date().toISOString(),
      });
      setWeightKg("");
      await onWeightAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="patient-field col-span-7">
      <label htmlFor="weight-input" className="patient-field-label">
        {copy.weightKg} — {copy.latestWeight}: {latestWeight ?? copy.notSet}{" "}
        {latestWeight ? copy.weightKg : ""}
      </label>
      <div className="inline-weight-row">
        <select
          value={selectedHistoryId}
          onChange={(e) => setSelectedHistoryId(e.target.value)}
          className="patient-weight-select font-mono"
          title={copy.weightHistoryHeading}
          aria-label={copy.weightHistoryHeading}
        >
          <option value="">
            📋 {copy.weightHistoryHeading} ({weights.length})
          </option>
          {weights.map((w) => (
            <option key={w.id} value={w.id}>
              {new Date(w.measuredAt).toLocaleDateString(locale)} —{" "}
              {formatCanonicalDecimal(w.weightKg)} {copy.weightKg}
            </option>
          ))}
        </select>
        <input
          id="weight-input"
          type="text"
          inputMode="decimal"
          value={weightKg}
          onChange={(e) => {
            setWeightKg(e.target.value);
            if (error) setError(null);
          }}
          placeholder={`+ ${copy.weightKg}`}
          data-testid="input-weight"
          aria-label={copy.weightKg}
          aria-invalid={!isInputValid}
          disabled={!canManage || submitting}
          className="patient-field-input patient-weight-input font-mono"
        />
        {canManage && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={submitting || !hasInput || !isInputValid || !patientId}
            data-testid="add-weight-button"
            className="btn-primary patient-weight-save-btn"
          >
            {submitting ? copy.loading : copy.save}
          </button>
        )}
      </div>
      {selectedMeasurement && (
        <div className="patient-selected-weight-note font-mono">
          {copy.selectedWeightDetails(
            new Date(selectedMeasurement.measuredAt).toLocaleDateString(locale),
            formatCanonicalDecimal(selectedMeasurement.weightKg),
          )}
        </div>
      )}
      {!isInputValid && hasInput && (
        <div className="patient-field-error" role="alert">
          {copy.invalidWeightFormat}
        </div>
      )}
      {error && (
        <div
          className="denial-alert"
          role="alert"
          style={{ marginTop: "0.25rem" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

export function WeightHistorySection({
  weights,
}: {
  readonly weights: readonly PatientWeightMeasurementResponse[];
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];

  return (
    <section
      className="patient-history-section"
      aria-labelledby="weight-history-heading"
    >
      <div className="patient-section-header">
        <h3 id="weight-history-heading" style={{ margin: 0 }}>
          {copy.weightHistoryHeading}
        </h3>
        {weights.length > 0 && (
          <span
            style={{
              fontFamily: "var(--font-family-mono)",
              fontSize: "0.75rem",
              color: "var(--muted-foreground)",
            }}
          >
            {copy.latestWeight}: {formatCanonicalDecimal(weights[0]?.weightKg)}{" "}
            {copy.weightKg}
          </span>
        )}
      </div>

      {/* Weight History Table (Append-only, strictly no edit/delete buttons) */}
      <div style={{ overflowX: "auto" }}>
        <table
          className="weight-history-table"
          data-testid="weight-history-table"
        >
          <caption
            style={{
              textAlign: "start",
              padding: "0.25rem 0",
              color: "var(--muted-foreground)",
              fontSize: "0.6875rem",
            }}
          >
            {copy.weightHistoryHeading}
          </caption>
          <thead>
            <tr>
              <th scope="col">{copy.weightMeasuredAt}</th>
              <th scope="col">{copy.weightKg}</th>
            </tr>
          </thead>
          <tbody>
            {weights.length === 0 ? (
              <tr>
                <td
                  colSpan={2}
                  style={{
                    textAlign: "center",
                    color: "var(--muted-foreground)",
                    padding: "1.5rem",
                  }}
                >
                  {copy.noWeightMeasurements}
                </td>
              </tr>
            ) : (
              weights.map((w) => (
                <tr key={w.id}>
                  <td style={{ fontFamily: "var(--font-family-mono)" }}>
                    {new Date(w.measuredAt).toLocaleString(locale)}
                  </td>
                  <td
                    style={{
                      fontFamily: "var(--font-family-mono)",
                      fontWeight: 700,
                    }}
                  >
                    {formatCanonicalDecimal(w.weightKg)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
