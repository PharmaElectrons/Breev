import { useRef, useState } from "react";
import type {
  PatientProfileResponse,
  PatientWeightMeasurementResponse,
  UpdatePatientRequest,
} from "@breev/contracts/local-rest";
import {
  formatCanonicalDecimal,
  isValidPatientWeight,
} from "../lib/exact-decimal";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";
import { formatPatientDateTime } from "./patient-date-time";
import {
  newPatientIdempotencyKey,
  PatientsApiDenied,
  PatientsApiIdempotencyConflict,
  PatientsApiOutcomeUnknown,
  PatientsApiValidationFailure,
  PatientsApiVersionConflict,
  updatePatientProfile,
} from "./patient-api";

type WeightAppendCommand = {
  readonly request: UpdatePatientRequest;
};

export function BmiCard({
  patient,
}: {
  readonly patient: Pick<
    PatientProfileResponse,
    "bmi" | "bmiCategory" | "heightCm"
  >;
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];
  const value = patient.bmi ? formatCanonicalDecimal(patient.bmi) : null;
  const category = patient.bmiCategory
    ? copy.bmiCategory(patient.bmiCategory)
    : null;
  const emptyMessage = patient.heightCm
    ? copy.bmiNeedsWeight
    : copy.bmiNeedsHeight;

  return (
    <div className="bmi-card col-span-2">
      <p className="bmi-card-label">{copy.bmi}</p>
      <p className="bmi-card-value" data-testid="view-bmi">
        {value ? `${value}${category ? ` (${category})` : ""}` : emptyMessage}
      </p>
      {category && <p className="bmi-card-category">{category}</p>}
    </div>
  );
}

export function InlineWeightInput({
  patient,
  weights,
  onWeightAdded,
  onConflict,
  canManage,
  businessTimeZone,
}: {
  readonly patient: Pick<PatientProfileResponse, "id" | "revision">;
  readonly weights: readonly PatientWeightMeasurementResponse[];
  readonly onWeightAdded: () => Promise<void> | void;
  readonly onConflict: () => Promise<void> | void;
  readonly canManage: boolean;
  readonly businessTimeZone: string;
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];
  const [weightKg, setWeightKg] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requiresExactRetry, setRequiresExactRetry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const pendingCommandRef = useRef<WeightAppendCommand | null>(null);

  const normalizedWeight = weightKg.trim().replace(",", ".");
  const hasInput = normalizedWeight.length > 0;
  const isInputValid = !hasInput || isValidPatientWeight(normalizedWeight);
  const latestWeight = weights[0]
    ? formatCanonicalDecimal(weights[0].weightKg)
    : null;
  const selectedMeasurement = weights.find(
    (measurement) => measurement.id === selectedHistoryId,
  );
  const selectedDateTime = selectedMeasurement
    ? formatPatientDateTime(
        selectedMeasurement.measuredAt,
        locale,
        businessTimeZone,
      )
    : null;

  const handleSave = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!hasInput || !isInputValid || !canManage || submitting) return;
    setError(null);
    setStatus(null);
    setSubmitting(true);

    try {
      let command = pendingCommandRef.current;
      if (command === null) {
        command = {
          request: {
            weightMeasurement: {
              weightKg: normalizedWeight,
              measuredAt: new Date().toISOString(),
            },
            expectedRevision: patient.revision,
            idempotencyKey: newPatientIdempotencyKey(),
          },
        };
        pendingCommandRef.current = command;
      }

      await updatePatientProfile(
        new AbortController().signal,
        patient.id,
        command.request,
      );
      pendingCommandRef.current = null;
      setRequiresExactRetry(false);
      setWeightKg("");
      setSelectedHistoryId("");
      setStatus(copy.saved);
      await onWeightAdded();
    } catch (requestError) {
      if (requestError instanceof PatientsApiOutcomeUnknown) {
        setRequiresExactRetry(true);
        setStatus(copy.unknownSaveOutcome);
      } else {
        pendingCommandRef.current = null;
        setRequiresExactRetry(false);
        if (requestError instanceof PatientsApiVersionConflict) {
          setError(copy.conflictError);
          await onConflict();
        } else if (requestError instanceof PatientsApiIdempotencyConflict) {
          setError(copy.idempotencyConflict);
        } else if (requestError instanceof PatientsApiValidationFailure) {
          setError(copy.invalidWeightFormat);
        } else if (requestError instanceof PatientsApiDenied) {
          setError(copy.permissionDenied);
        } else {
          setError(copy.saveUnavailable);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="patient-field col-span-7"
      onSubmit={(event) => void handleSave(event)}
    >
      <label htmlFor="weight-input" className="patient-field-label">
        {copy.weightKg} — {copy.latestWeight}: {latestWeight ?? copy.notSet}
        {latestWeight ? ` ${copy.weightKg}` : ""}
      </label>
      <div className="inline-weight-row">
        <select
          value={selectedHistoryId}
          onChange={(event) => setSelectedHistoryId(event.target.value)}
          className="patient-weight-select font-mono"
          aria-label={copy.weightHistoryHeading}
        >
          <option value="">
            {copy.weightHistoryHeading} ({weights.length})
          </option>
          {weights.map((measurement) => {
            const dateTime = formatPatientDateTime(
              measurement.measuredAt,
              locale,
              businessTimeZone,
            );
            return (
              <option key={measurement.id} value={measurement.id}>
                {dateTime ?? copy.timeZoneUnavailable} —{" "}
                {formatCanonicalDecimal(measurement.weightKg)} {copy.weightKg}
              </option>
            );
          })}
        </select>
        <input
          id="weight-input"
          type="text"
          inputMode="decimal"
          value={weightKg}
          onChange={(event) => {
            setWeightKg(event.target.value);
            setError(null);
          }}
          placeholder={`+ ${copy.weightKg}`}
          data-testid="input-weight"
          aria-label={copy.weightKg}
          aria-invalid={!isInputValid}
          aria-describedby={
            !isInputValid ? "patient-inline-weight-error" : undefined
          }
          disabled={!canManage || submitting || requiresExactRetry}
          className="patient-field-input patient-weight-input font-mono"
        />
        {canManage && (
          <button
            type="submit"
            disabled={submitting || !hasInput || !isInputValid}
            data-testid="add-weight-button"
            className="btn-primary patient-weight-save-btn"
          >
            {submitting
              ? copy.loading
              : requiresExactRetry
                ? copy.retrySave
                : copy.addWeight}
          </button>
        )}
      </div>
      {selectedMeasurement && (
        <p className="patient-selected-weight-note" role="status">
          {copy.selectedWeightDetails(
            selectedDateTime ?? copy.timeZoneUnavailable,
            formatCanonicalDecimal(selectedMeasurement.weightKg),
          )}
        </p>
      )}
      {!isInputValid && hasInput && (
        <p
          id="patient-inline-weight-error"
          className="patient-field-error"
          role="alert"
        >
          {copy.invalidWeightFormat}
        </p>
      )}
      {error && (
        <p className="denial-alert" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="patient-form-status" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </form>
  );
}

export function WeightHistorySection({
  weights,
  businessTimeZone,
  hasMore,
  loadingMore,
  loadError,
  onLoadMore,
}: {
  readonly weights: readonly PatientWeightMeasurementResponse[];
  readonly businessTimeZone: string;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly loadError: boolean;
  readonly onLoadMore: () => void;
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];

  return (
    <section
      className="patient-history-section"
      aria-labelledby="weight-history-heading"
    >
      <div className="patient-section-header">
        <h3 id="weight-history-heading" className="patient-history-title">
          {copy.weightHistoryHeading}
        </h3>
        <span className="patient-history-latest">
          {copy.latestWeight}:{" "}
          {weights[0]
            ? formatCanonicalDecimal(weights[0].weightKg)
            : copy.notSet}
          {weights[0] ? ` ${copy.weightKg}` : ""}
        </span>
      </div>

      <div className="patient-history-scroll">
        <table
          className="weight-history-table"
          data-testid="weight-history-table"
        >
          <caption>{copy.weightHistoryHeading}</caption>
          <thead>
            <tr>
              <th scope="col">{copy.weightMeasuredAt}</th>
              <th scope="col">{copy.weightKg}</th>
            </tr>
          </thead>
          <tbody>
            {weights.length === 0 ? (
              <tr>
                <td colSpan={2} className="patient-history-empty">
                  {copy.noWeightMeasurements}
                </td>
              </tr>
            ) : (
              weights.map((measurement) => {
                const dateTime = formatPatientDateTime(
                  measurement.measuredAt,
                  locale,
                  businessTimeZone,
                );
                return (
                  <tr key={measurement.id}>
                    <td>
                      {dateTime ? (
                        <time dateTime={measurement.measuredAt}>
                          {dateTime}
                        </time>
                      ) : (
                        copy.timeZoneUnavailable
                      )}
                    </td>
                    <td>{formatCanonicalDecimal(measurement.weightKg)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {loadError && (
        <div className="patient-history-load-error" role="alert">
          <p>{copy.weightHistoryLoadError}</p>
          <button type="button" className="btn-outline" onClick={onLoadMore}>
            {copy.retryAction}
          </button>
        </div>
      )}
      {loadingMore && (
        <p className="patient-form-status" role="status" aria-live="polite">
          {copy.loadingWeights}
        </p>
      )}
      {hasMore && !loadingMore && !loadError && (
        <button
          type="button"
          className="btn-outline patient-load-more-weights"
          onClick={onLoadMore}
        >
          {copy.loadMoreWeights}
        </button>
      )}
    </section>
  );
}
