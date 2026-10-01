import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CreatePatientRequest,
  PatientProfileResponse,
  PatientWeightMeasurementResponse,
  UpdatePatientRequest,
} from "@breev/contracts/local-rest";
import { useCommittedFocus } from "../committed-focus";
import {
  formatCanonicalDecimal,
  isValidPatientDiscount,
  isValidPatientHeight,
  isValidPatientWeight,
} from "../lib/exact-decimal";
import { directionForLocale } from "../preferences";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";
import {
  createPatient,
  getPatientProfile,
  PatientsApiIdempotencyConflict,
  newPatientIdempotencyKey,
  PatientsApiDenied,
  PatientsApiNotFound,
  PatientsApiOutcomeUnknown,
  PatientsApiValidationFailure,
  PatientsApiVersionConflict,
  updatePatientProfile,
} from "./patient-api";
import { formatPatientDateTime } from "./patient-date-time";
import { AllergyPicker } from "./allergy-picker";

type PatientGender = "male" | "female";
type PendingPatientCommand =
  | { readonly kind: "create"; readonly body: CreatePatientRequest }
  | {
      readonly kind: "update";
      readonly patientId: string;
      readonly body: UpdatePatientRequest;
    };

export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dob);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  )
    return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const checkedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    checkedDate.getUTCFullYear() !== year ||
    checkedDate.getUTCMonth() !== month - 1 ||
    checkedDate.getUTCDate() !== day
  ) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - year;
  const currentMonth = today.getMonth() + 1;
  if (
    currentMonth < month ||
    (currentMonth === month && today.getDate() < day)
  ) {
    age--;
  }
  return age >= 0 ? age : null;
}

export function PatientForm({
  patient,
  weights = [],
  businessTimeZone = "",
  onSaved,
  onCancel,
  canManageNotes,
  canManageDiscounts,
}: {
  readonly patient?: PatientProfileResponse | null | undefined;
  readonly weights?: readonly PatientWeightMeasurementResponse[] | undefined;
  readonly businessTimeZone?: string | undefined;
  readonly onSaved: (patient: PatientProfileResponse) => void;
  readonly onCancel: () => void;
  readonly canManageNotes: boolean;
  readonly canManageDiscounts: boolean;
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];
  const isEditing = patient !== null && patient !== undefined;
  const requestCommittedFocus = useCommittedFocus();

  const [firstName, setFirstName] = useState(patient?.firstName ?? "");
  const [lastName, setLastName] = useState(patient?.lastName ?? "");
  const [phone, setPhone] = useState(patient?.phone ?? "");
  const [address, setAddress] = useState(patient?.address ?? "");
  const [email, setEmail] = useState(patient?.email ?? "");
  const [gender, setGender] = useState<PatientGender | null>(
    patient?.gender ?? null,
  );
  const [dateOfBirth, setDateOfBirth] = useState(patient?.dateOfBirth ?? "");
  const [heightCm, setHeightCm] = useState(patient?.heightCm ?? "");
  const [discountPercent, setDiscountPercent] = useState(
    canManageDiscounts ? (patient?.discountPercent ?? "") : "",
  );
  const [doNotDisturb, setDoNotDisturb] = useState(
    patient?.doNotDisturb ?? false,
  );
  const [weightKg, setWeightKg] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState("");

  const [chronicConditions, setChronicConditions] = useState<string[]>([
    ...(patient?.chronicConditions ?? []),
  ]);
  const [conditionsInput, setConditionsInput] = useState("");
  const [chronicMedications, setChronicMedications] = useState<string[]>([
    ...(patient?.chronicMedications ?? []),
  ]);
  const [medicationsInput, setMedicationsInput] = useState("");
  const [interests, setInterests] = useState<string[]>([
    ...(patient?.interests ?? []),
  ]);
  const [interestsInput, setInterestsInput] = useState("");

  const [otherNotes, setOtherNotes] = useState(
    canManageNotes ? (patient?.otherNotes ?? "") : "",
  );
  const [sensitivities, setSensitivities] = useState(
    canManageNotes ? (patient?.sensitivities ?? "") : "",
  );
  const [isSmoker, setIsSmoker] = useState(
    canManageNotes && Boolean(patient?.smoking),
  );
  const [smokingNotes, setSmokingNotes] = useState(
    canManageNotes ? (patient?.smoking ?? "") : "",
  );
  const initialAllergies = useMemo(
    () =>
      canManageNotes && patient?.allergies
        ? patient.allergies
            .split(/[,،]/)
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
    [canManageNotes, patient?.allergies],
  );
  const [hasAllergy, setHasAllergy] = useState(initialAllergies.length > 0);
  const [allergies, setAllergies] = useState<string[]>(initialAllergies);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<readonly string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [requiresExactRetry, setRequiresExactRetry] = useState(false);
  const [conflictNeedsReload, setConflictNeedsReload] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [expectedRevision, setExpectedRevision] = useState(
    patient?.revision ?? "",
  );
  const pendingCommandRef = useRef<PendingPatientCommand | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const discardButtonRef = useRef<HTMLButtonElement>(null);

  const markDirty = useCallback(() => {
    setIsDirty(true);
    setInvalidFields([]);
    setFormError(null);
  }, []);
  const computedAge = useMemo(() => ageFromDob(dateOfBirth), [dateOfBirth]);
  const normalizedHeight = heightCm.trim().replace(",", ".");
  const normalizedWeight = weightKg.trim().replace(",", ".");
  const normalizedDiscount = discountPercent.trim().replace(",", ".");
  const hasHeight = normalizedHeight.length > 0;
  const hasWeight = normalizedWeight.length > 0;
  const hasDiscount = normalizedDiscount.length > 0;
  const isHeightValid = !hasHeight || isValidPatientHeight(normalizedHeight);
  const isWeightValid = !hasWeight || isValidPatientWeight(normalizedWeight);
  const isDiscountValid =
    !hasDiscount || isValidPatientDiscount(normalizedDiscount);
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
  const requestDiscard = useCallback(() => {
    if (submitting || requiresExactRetry || conflictNeedsReload) return;
    if (!isDirty) {
      onCancel();
      return;
    }
    setConfirmDiscard(true);
    requestCommittedFocus(() => keepEditingRef.current);
  }, [
    conflictNeedsReload,
    isDirty,
    onCancel,
    requestCommittedFocus,
    requiresExactRetry,
    submitting,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || confirmDiscard) {
        return;
      }
      event.preventDefault();
      requestDiscard();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmDiscard, requestDiscard]);

  const handleDiscardDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setConfirmDiscard(false);
      requestCommittedFocus(() => cancelButtonRef.current);
      return;
    }
    if (event.key !== "Tab") return;
    const first = keepEditingRef.current;
    const last = discardButtonRef.current;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const handleConditionsKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter" || !conditionsInput.trim()) return;
    event.preventDefault();
    setChronicConditions((current) =>
      current.includes(conditionsInput.trim())
        ? current
        : [...current, conditionsInput.trim()],
    );
    setConditionsInput("");
    markDirty();
  };

  const handleMedicationsKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter" || !medicationsInput.trim()) return;
    event.preventDefault();
    setChronicMedications((current) =>
      current.includes(medicationsInput.trim())
        ? current
        : [...current, medicationsInput.trim()],
    );
    setMedicationsInput("");
    markDirty();
  };

  const handleInterestsKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter" || !interestsInput.trim()) return;
    event.preventDefault();
    setInterests((current) =>
      current.includes(interestsInput.trim())
        ? current
        : [...current, interestsInput.trim()],
    );
    setInterestsInput("");
    markDirty();
  };

  const removeTag = (
    remove: (update: (current: string[]) => string[]) => void,
    fieldId: string,
    value: string,
  ) => {
    remove((current) => current.filter((item) => item !== value));
    markDirty();
    requestCommittedFocus(() => document.getElementById(fieldId));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setFormError(copy.nameRequired);
      requestCommittedFocus(() =>
        document.getElementById(
          firstName.trim() ? "last-name-input" : "first-name-input",
        ),
      );
      return;
    }
    if (hasHeight && !isHeightValid) {
      setFormError(copy.invalidHeightFormat);
      return;
    }
    if (hasWeight && !isWeightValid) {
      setFormError(copy.invalidWeightFormat);
      return;
    }
    if (canManageDiscounts && hasDiscount && !isDiscountValid) {
      setFormError(copy.invalidDiscountFormat);
      return;
    }
    if (canManageNotes && hasAllergy && allergies.length === 0) {
      setFormError(copy.allergyRequired);
      return;
    }
    if (conflictNeedsReload) return;
    if (requiresExactRetry && pendingCommandRef.current === null) return;

    setFormError(null);
    setFormStatus(copy.saving);
    setSubmitting(true);
    try {
      let command = pendingCommandRef.current;
      if (command === null) {
        const commandFields = {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          email: email.trim() || null,
          gender,
          dateOfBirth: dateOfBirth || null,
          heightCm: normalizedHeight || null,
          interests: Array.from(
            new Set([
              ...interests,
              ...(interestsInput.trim() ? [interestsInput.trim()] : []),
            ]),
          ),
          doNotDisturb,
        };
        const noteFields = canManageNotes
          ? {
              chronicConditions: Array.from(
                new Set([
                  ...chronicConditions,
                  ...(conditionsInput.trim() ? [conditionsInput.trim()] : []),
                ]),
              ),
              chronicMedications: Array.from(
                new Set([
                  ...chronicMedications,
                  ...(medicationsInput.trim() ? [medicationsInput.trim()] : []),
                ]),
              ),
              allergies: hasAllergy ? allergies.join(", ") : null,
              smoking: isSmoker ? smokingNotes.trim() || copy.isSmoker : null,
              sensitivities: sensitivities.trim() || null,
              otherNotes: otherNotes.trim() || null,
            }
          : {};
        const discountFields = canManageDiscounts
          ? { discountPercent: normalizedDiscount || null }
          : {};
        const weightMeasurement = hasWeight
          ? {
              weightKg: normalizedWeight,
              measuredAt: new Date().toISOString(),
            }
          : undefined;
        const optionalMeasurement =
          weightMeasurement === undefined ? {} : { weightMeasurement };
        const idempotencyKey = newPatientIdempotencyKey();

        const newCommand: PendingPatientCommand = patient
          ? {
              kind: "update",
              patientId: patient.id,
              body: {
                ...commandFields,
                ...noteFields,
                ...discountFields,
                ...optionalMeasurement,
                expectedRevision,
                idempotencyKey,
              },
            }
          : {
              kind: "create",
              body: {
                ...commandFields,
                ...noteFields,
                ...discountFields,
                ...optionalMeasurement,
                idempotencyKey,
              },
            };
        pendingCommandRef.current = newCommand;
        command = newCommand;
      }

      const abort = new AbortController();
      const saved =
        command.kind === "create"
          ? await createPatient(abort.signal, command.body)
          : await updatePatientProfile(
              abort.signal,
              command.patientId,
              command.body,
            );
      pendingCommandRef.current = null;
      setRequiresExactRetry(false);
      setConflictNeedsReload(false);
      setFormStatus(copy.saved);
      setIsDirty(false);
      onSaved(saved);
    } catch (error) {
      if (error instanceof PatientsApiOutcomeUnknown) {
        setRequiresExactRetry(true);
        setFormError(null);
        setFormStatus(copy.unknownSaveOutcome);
      } else {
        pendingCommandRef.current = null;
        setRequiresExactRetry(false);
        setFormStatus(null);
        if (error instanceof PatientsApiVersionConflict) {
          setConflictNeedsReload(true);
          setFormError(copy.conflictError);
        } else if (error instanceof PatientsApiIdempotencyConflict) {
          setFormError(copy.idempotencyConflict);
        } else if (error instanceof PatientsApiValidationFailure) {
          setInvalidFields(error.fields);
          setFormError(copy.validationFailed);
        } else if (error instanceof PatientsApiDenied) {
          setFormError(copy.permissionDenied);
        } else if (error instanceof PatientsApiNotFound) {
          setFormError(copy.profileNotFound);
        } else {
          setFormError(copy.saveUnavailable);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reloadLatestRevision = async () => {
    if (!patient) return;
    setSubmitting(true);
    setFormError(null);
    setFormStatus(copy.loadingLatest);
    try {
      const latest = await getPatientProfile(
        new AbortController().signal,
        patient.id,
      );
      setExpectedRevision(latest.revision);
      setConflictNeedsReload(false);
      setFormStatus(copy.conflictReconciled);
    } catch (error) {
      setFormStatus(null);
      setFormError(
        error instanceof PatientsApiDenied
          ? copy.permissionDenied
          : error instanceof PatientsApiNotFound
            ? copy.profileNotFound
            : copy.profileLoadError,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelClick = () => requestDiscard();

  const removeCondition = (value: string) =>
    removeTag(setChronicConditions, "conditions-input", value);
  const removeMedication = (value: string) =>
    removeTag(setChronicMedications, "medications-input", value);
  const removeInterest = (value: string) =>
    removeTag(setInterests, "interests-input", value);

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="patient-edit-form"
      className="patient-profile patient-editor"
      dir={directionForLocale(locale)}
    >
      <div className="patient-profile-header">
        <h2 className="patient-profile-title">
          {isEditing
            ? `${firstName || patient?.firstName || ""} ${lastName || patient?.lastName || ""}`.trim() ||
              copy.editHeading
            : copy.createHeading}
        </h2>
        <div className="patient-header-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={handleCancelClick}
            disabled={submitting || requiresExactRetry || conflictNeedsReload}
            className="btn-secondary"
          >
            {copy.cancel}
          </button>
          <button
            type="submit"
            disabled={submitting || conflictNeedsReload}
            data-testid="save-patient-button"
            className="btn-primary"
          >
            {submitting
              ? copy.loading
              : requiresExactRetry
                ? copy.retrySave
                : isEditing
                  ? copy.update
                  : copy.save}
          </button>
        </div>
      </div>

      {formError && (
        <div className="denial-alert" role="alert">
          {formError}
          {conflictNeedsReload && (
            <button
              type="button"
              className="btn-outline patient-conflict-reload"
              onClick={() => void reloadLatestRevision()}
              disabled={submitting}
            >
              {copy.reloadLatest}
            </button>
          )}
        </div>
      )}
      {formStatus && (
        <p className="patient-form-status" role="status" aria-live="polite">
          {formStatus}
        </p>
      )}

      <fieldset
        className="patient-form-fields"
        disabled={submitting || requiresExactRetry}
      >
        <div className="patient-grid-layout">
          <div className="patient-field col-span-3">
            <span className="patient-field-label">{copy.fullName} *</span>
            <div className="patient-name-fields">
              <input
                id="first-name-input"
                data-testid="input-first-name"
                required
                maxLength={100}
                aria-label={copy.firstName}
                aria-invalid={invalidFields.includes("firstName") || undefined}
                placeholder={copy.firstName}
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                  markDirty();
                }}
                className="patient-field-input"
              />
              <input
                id="last-name-input"
                data-testid="input-last-name"
                required
                maxLength={100}
                aria-label={copy.lastName}
                aria-invalid={invalidFields.includes("lastName") || undefined}
                placeholder={copy.lastName}
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                  markDirty();
                }}
                className="patient-field-input"
              />
            </div>
          </div>

          <div className="patient-field col-span-2">
            <label htmlFor="phone-input" className="patient-field-label">
              {copy.phone}
            </label>
            <input
              id="phone-input"
              data-testid="input-phone"
              maxLength={20}
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                markDirty();
              }}
              className="patient-field-input font-mono"
            />
          </div>

          <div className="patient-field col-span-3">
            <label htmlFor="address-input" className="patient-field-label">
              {copy.address}
            </label>
            <input
              id="address-input"
              data-testid="input-address"
              maxLength={500}
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                markDirty();
              }}
              className="patient-field-input"
            />
          </div>

          <div className="patient-field col-span-2">
            <span id="patient-gender-label" className="patient-field-label">
              {copy.gender}
            </span>
            <div
              className="gender-toggle-group"
              role="group"
              aria-labelledby="patient-gender-label"
            >
              <button
                type="button"
                aria-pressed={gender === "male"}
                onClick={() => {
                  setGender(gender === "male" ? null : "male");
                  markDirty();
                }}
                className={`gender-toggle-btn ${gender === "male" ? "active" : ""}`}
              >
                {copy.male}
              </button>
              <button
                type="button"
                aria-pressed={gender === "female"}
                onClick={() => {
                  setGender(gender === "female" ? null : "female");
                  markDirty();
                }}
                className={`gender-toggle-btn ${gender === "female" ? "active" : ""}`}
              >
                {copy.female}
              </button>
            </div>
          </div>

          <div className="patient-field col-span-2">
            <label htmlFor="dob-input" className="patient-field-label">
              {copy.dateOfBirth} / {copy.age}
            </label>
            <div className="patient-dob-row">
              <input
                id="dob-input"
                type="date"
                value={dateOfBirth}
                onChange={(event) => {
                  setDateOfBirth(event.target.value);
                  markDirty();
                }}
                className="patient-field-input"
              />
              <span className="patient-age-badge font-mono">
                {computedAge !== null ? `${computedAge}` : copy.notSet}
              </span>
            </div>
          </div>
        </div>

        <div className="patient-grid-layout">
          <div className="patient-field col-span-3">
            <label htmlFor="height-input" className="patient-field-label">
              {copy.heightCm}
            </label>
            <input
              id="height-input"
              data-testid="input-height"
              type="text"
              inputMode="decimal"
              aria-invalid={
                !isHeightValid || invalidFields.includes("heightCm")
              }
              aria-describedby={
                !isHeightValid ? "patient-height-error" : undefined
              }
              maxLength={7}
              placeholder={copy.heightCm}
              value={heightCm}
              onChange={(event) => {
                setHeightCm(event.target.value);
                markDirty();
              }}
              className="patient-field-input font-mono"
            />
            {!isHeightValid && hasHeight && (
              <p
                id="patient-height-error"
                className="patient-field-error"
                role="alert"
              >
                {copy.invalidHeightFormat}
              </p>
            )}
          </div>

          <div className="patient-field col-span-7">
            <label htmlFor="input-weight" className="patient-field-label">
              {copy.weightKg}
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
                      {formatCanonicalDecimal(measurement.weightKg)}{" "}
                      {copy.weightKg}
                    </option>
                  );
                })}
              </select>
              <input
                id="input-weight"
                data-testid="input-weight"
                type="text"
                inputMode="decimal"
                aria-label={copy.weightKg}
                aria-invalid={
                  !isWeightValid || invalidFields.includes("weightMeasurement")
                }
                aria-describedby={
                  !isWeightValid ? "patient-weight-error" : undefined
                }
                maxLength={7}
                value={weightKg}
                onChange={(event) => {
                  setWeightKg(event.target.value);
                  markDirty();
                }}
                placeholder={`+ ${copy.weightKg}`}
                className="patient-field-input patient-weight-input font-mono"
              />
            </div>
            {!isWeightValid && hasWeight && (
              <p
                id="patient-weight-error"
                className="patient-field-error"
                role="alert"
              >
                {copy.invalidWeightFormat}
              </p>
            )}
            {selectedMeasurement && (
              <p className="patient-selected-weight-note" role="status">
                {copy.selectedWeightDetails(
                  selectedDateTime ?? copy.timeZoneUnavailable,
                  formatCanonicalDecimal(selectedMeasurement.weightKg),
                )}
              </p>
            )}
          </div>

          <div className="bmi-card col-span-2" aria-label={copy.bmi}>
            <p className="bmi-card-label">{copy.bmi}</p>
            <p className="bmi-card-category">{copy.bmiAfterSave}</p>
          </div>
        </div>

        {(canManageDiscounts || email || isEditing) && (
          <div className="patient-grid-layout">
            {canManageDiscounts && (
              <div className="patient-field col-span-3">
                <label htmlFor="discount-input" className="patient-field-label">
                  {copy.discountPercent} (%)
                </label>
                <input
                  id="discount-input"
                  data-testid="input-discount"
                  type="text"
                  inputMode="decimal"
                  maxLength={6}
                  aria-invalid={
                    !isDiscountValid ||
                    invalidFields.includes("discountPercent")
                  }
                  aria-describedby={
                    !isDiscountValid ? "patient-discount-error" : undefined
                  }
                  placeholder="0.00"
                  value={discountPercent}
                  onChange={(event) => {
                    setDiscountPercent(event.target.value);
                    markDirty();
                  }}
                  className="patient-field-input font-mono"
                />
                {!isDiscountValid && hasDiscount && (
                  <p
                    id="patient-discount-error"
                    className="patient-field-error"
                    role="alert"
                  >
                    {copy.invalidDiscountFormat}
                  </p>
                )}
              </div>
            )}
            <div className="patient-field col-span-4">
              <label htmlFor="email-input" className="patient-field-label">
                {copy.email}
              </label>
              <input
                id="email-input"
                type="email"
                data-testid="input-email"
                maxLength={254}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  markDirty();
                }}
                className="patient-field-input"
              />
            </div>
          </div>
        )}

        <div className="patient-grid-layout">
          {canManageNotes && (
            <>
              <div className="patient-field col-span-4">
                <label
                  htmlFor="conditions-input"
                  className="patient-field-label"
                >
                  {copy.chronicConditions}
                </label>
                <div className="tag-field-container">
                  {chronicConditions.map((condition) => (
                    <span key={condition} className="tag-chip tag-chip-rose">
                      {condition}
                      <button
                        type="button"
                        onClick={() => removeCondition(condition)}
                        className="tag-chip-remove"
                        aria-label={`${copy.removeItem} ${condition}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    id="conditions-input"
                    data-testid="input-conditions"
                    maxLength={200}
                    value={conditionsInput}
                    onChange={(event) => {
                      setConditionsInput(event.target.value);
                      markDirty();
                    }}
                    onKeyDown={handleConditionsKeyDown}
                    placeholder={copy.addConditionPlaceholder}
                    className="tag-field-input"
                  />
                </div>
              </div>

              <div className="patient-field col-span-4">
                <label
                  htmlFor="medications-input"
                  className="patient-field-label"
                >
                  {copy.chronicMedications}
                </label>
                <div className="tag-field-container">
                  {chronicMedications.map((medication) => (
                    <span
                      key={medication}
                      className="tag-chip tag-chip-emerald"
                    >
                      {medication}
                      <button
                        type="button"
                        onClick={() => removeMedication(medication)}
                        className="tag-chip-remove"
                        aria-label={`${copy.removeItem} ${medication}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    id="medications-input"
                    maxLength={200}
                    value={medicationsInput}
                    onChange={(event) => {
                      setMedicationsInput(event.target.value);
                      markDirty();
                    }}
                    onKeyDown={handleMedicationsKeyDown}
                    placeholder={copy.addMedicationPlaceholder}
                    className="tag-field-input"
                  />
                </div>
              </div>
            </>
          )}

          <div className="patient-field col-span-4">
            <label htmlFor="interests-input" className="patient-field-label">
              {copy.interests}
            </label>
            <div className="tag-field-container">
              {interests.map((interest) => (
                <span key={interest} className="tag-chip tag-chip-amber">
                  {interest}
                  <button
                    type="button"
                    onClick={() => removeInterest(interest)}
                    className="tag-chip-remove"
                    aria-label={`${copy.removeItem} ${interest}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                id="interests-input"
                maxLength={200}
                value={interestsInput}
                onChange={(event) => {
                  setInterestsInput(event.target.value);
                  markDirty();
                }}
                onKeyDown={handleInterestsKeyDown}
                placeholder={copy.addInterestPlaceholder}
                className="tag-field-input"
              />
            </div>
          </div>
        </div>

        <div className="patient-grid-layout patient-notes-row">
          {canManageNotes && (
            <div className="patient-field col-span-7">
              <label htmlFor="notes-textarea" className="patient-field-label">
                {copy.otherNotes}
              </label>
              <textarea
                id="notes-textarea"
                data-testid="input-notes"
                maxLength={5000}
                rows={3}
                value={otherNotes}
                onChange={(event) => {
                  setOtherNotes(event.target.value);
                  markDirty();
                }}
                className="patient-field-textarea"
              />
              <label
                htmlFor="sensitivities-input"
                className="patient-field-label"
              >
                {copy.sensitivities}
              </label>
              <textarea
                id="sensitivities-input"
                data-testid="input-sensitivities"
                maxLength={2000}
                rows={2}
                value={sensitivities}
                onChange={(event) => {
                  setSensitivities(event.target.value);
                  markDirty();
                }}
                className="patient-field-textarea"
              />
            </div>
          )}

          <div
            className={`patient-field ${canManageNotes ? "col-span-5" : "col-span-12"}`}
          >
            <span className="patient-field-label">
              {copy.lifestyleAndMedical}
            </span>
            <div className="prototype-toggle-row">
              {canManageNotes && (
                <button
                  type="button"
                  aria-pressed={isSmoker}
                  onClick={() => {
                    setIsSmoker((current) => !current);
                    markDirty();
                  }}
                  className={`patient-toggle-btn ${isSmoker ? "active" : ""}`}
                >
                  <span>{copy.isSmoker}</span>
                  <span
                    className={`patient-toggle-track ${isSmoker ? "active" : ""}`}
                    aria-hidden="true"
                  >
                    <span className="patient-toggle-thumb" />
                  </span>
                </button>
              )}

              <label
                className={`patient-toggle-btn ${doNotDisturb ? "active" : ""}`}
              >
                <span>{copy.dnd}</span>
                <input
                  data-testid="input-dnd"
                  type="checkbox"
                  role="switch"
                  aria-label={copy.dnd}
                  checked={doNotDisturb}
                  onChange={(event) => {
                    setDoNotDisturb(event.target.checked);
                    markDirty();
                  }}
                  className="patient-toggle-input"
                />
                <span
                  className={`patient-toggle-track ${doNotDisturb ? "active" : ""}`}
                  aria-hidden="true"
                >
                  <span className="patient-toggle-thumb" />
                </span>
              </label>

              {canManageNotes && (
                <button
                  type="button"
                  data-testid="input-allergy-toggle"
                  aria-pressed={hasAllergy}
                  onClick={() => {
                    setHasAllergy((current) => !current);
                    markDirty();
                  }}
                  className={`patient-toggle-btn ${hasAllergy ? "active" : ""}`}
                >
                  <span>{copy.hasAllergy}</span>
                  <span
                    className={`patient-toggle-track ${hasAllergy ? "active" : ""}`}
                    aria-hidden="true"
                  >
                    <span className="patient-toggle-thumb" />
                  </span>
                </button>
              )}
            </div>

            {canManageNotes && isSmoker && (
              <div className="patient-smoking-details">
                <label htmlFor="smoking-input" className="patient-field-label">
                  {copy.smoking}
                </label>
                <input
                  id="smoking-input"
                  maxLength={500}
                  value={smokingNotes}
                  onChange={(event) => {
                    setSmokingNotes(event.target.value);
                    markDirty();
                  }}
                  placeholder={copy.smoking}
                  className="patient-field-input patient-subfield-input"
                />
              </div>
            )}

            {canManageNotes && hasAllergy && (
              <AllergyPicker
                value={allergies}
                onChange={(next) => {
                  setAllergies(next);
                  markDirty();
                }}
                disabled={submitting || requiresExactRetry}
              />
            )}
          </div>
        </div>
      </fieldset>

      {confirmDiscard && (
        <div className="patient-dialog-backdrop">
          <div
            className="patient-discard-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="patient-discard-title"
            aria-describedby="patient-discard-description"
            onKeyDown={handleDiscardDialogKeyDown}
          >
            <h3 id="patient-discard-title">{copy.discardChangesTitle}</h3>
            <p id="patient-discard-description">{copy.discardChangesMessage}</p>
            <div className="patient-dialog-actions">
              <button
                ref={keepEditingRef}
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setConfirmDiscard(false);
                  requestCommittedFocus(() => cancelButtonRef.current);
                }}
              >
                {copy.keepEditing}
              </button>
              <button
                ref={discardButtonRef}
                id="discard-patient-changes"
                type="button"
                className="btn-destructive"
                onClick={onCancel}
              >
                {copy.discardChanges}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
