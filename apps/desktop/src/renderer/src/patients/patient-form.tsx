import React, { useState, useEffect, useMemo, useCallback } from "react";
import type {
  PatientProfileResponse,
  PatientWeightMeasurementResponse,
} from "@breev/contracts/local-rest";

type PatientGender = "male" | "female";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";
import {
  createPatient,
  updatePatientProfile,
  updatePatientNotes,
  updatePatientDiscount,
  updatePatientDnd,
  addPatientWeight,
  getPatientProfile,
} from "./patient-api";
import {
  isValidPatientWeight,
  isValidPatientHeight,
  isValidPatientDiscount,
} from "../lib/exact-decimal";
import { BmiCard, InlineWeightInput } from "./weight-history";
import { AllergyPicker } from "./allergy-picker";

export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
}

export function PatientForm({
  patient,
  weights = [],
  onWeightAdded,
  onSaved,
  onCancel,
  canManageNotes,
  canManageDiscounts,
}: {
  readonly patient?: PatientProfileResponse | null | undefined;
  readonly weights?: readonly PatientWeightMeasurementResponse[] | undefined;
  readonly onWeightAdded?: (() => Promise<void> | void) | undefined;
  readonly onSaved: (patient: PatientProfileResponse) => void;
  readonly onCancel: () => void;
  readonly canManageNotes: boolean;
  readonly canManageDiscounts: boolean;
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];

  const isEditing = Boolean(patient);

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
    patient?.discountPercent ?? "",
  );
  const [doNotDisturb, setDoNotDisturb] = useState(
    patient?.doNotDisturb ?? false,
  );
  const [weightKg, setWeightKg] = useState("");

  // Notes & clinical tags
  const [otherNotes, setOtherNotes] = useState(patient?.otherNotes ?? "");
  const [chronicConditions, setChronicConditions] = useState<string[]>(
    patient?.chronicConditions ? [...patient.chronicConditions] : [],
  );
  const [conditionsInput, setConditionsInput] = useState("");

  const [chronicMedications, setChronicMedications] = useState<string[]>(
    patient?.chronicMedications ? [...patient.chronicMedications] : [],
  );
  const [medicationsInput, setMedicationsInput] = useState("");

  const [interests, setInterests] = useState<string[]>(
    patient?.interests ? [...patient.interests] : [],
  );
  const [interestsInput, setInterestsInput] = useState("");

  // Lifestyle indicators
  const initialIsSmoker = Boolean(
    patient?.smoking &&
    patient.smoking.trim().length > 0 &&
    !patient.smoking.toLowerCase().includes("non"),
  );
  const [isSmoker, setIsSmoker] = useState(initialIsSmoker);
  const [smokingNotes, setSmokingNotes] = useState(patient?.smoking ?? "");

  const initialAllergiesList = useMemo(() => {
    if (!patient?.allergies) return [];
    return patient.allergies
      .split(/[,،]/)
      .map((s) => s.trim())
      .filter((s) => Boolean(s) && s !== copy.hasAllergy);
  }, [patient?.allergies, copy.hasAllergy]);

  const [hasAllergy, setHasAllergy] = useState(
    Boolean(patient?.allergies) && patient?.allergies !== "none",
  );
  const [allergiesList, setAllergiesList] =
    useState<string[]>(initialAllergiesList);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const computedAge = useMemo(() => ageFromDob(dateOfBirth), [dateOfBirth]);

  const previewBmi = useMemo(() => {
    if (patient?.bmi) return patient.bmi;
    const h = Number(heightCm) / 100;
    const w = Number(weightKg);
    if (h > 0 && w > 0) {
      return (w / (h * h)).toFixed(1);
    }
    return null;
  }, [patient?.bmi, heightCm, weightKg]);

  const hasHeight = heightCm.trim().length > 0;
  const isHeightValid = !hasHeight || isValidPatientHeight(heightCm.trim());

  const hasWeight = weightKg.trim().length > 0;
  const isWeightValid = !hasWeight || isValidPatientWeight(weightKg.trim());

  const hasDiscount = discountPercent.trim().length > 0;
  const isDiscountValid =
    !hasDiscount || isValidPatientDiscount(discountPercent.trim());

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!isDirty || window.confirm(copy.unsavedChanges)) {
          onCancel();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, onCancel, copy.unsavedChanges]);

  const handleCancelClick = () => {
    if (!isDirty || window.confirm(copy.unsavedChanges)) {
      onCancel();
    }
  };

  const handleConditionsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConditionsInput(e.target.value);
  };

  const handleConditionsKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Enter" && conditionsInput.trim()) {
      e.preventDefault();
      const val = conditionsInput.trim();
      if (!chronicConditions.includes(val)) {
        setChronicConditions([...chronicConditions, val]);
      }
      setConditionsInput("");
      markDirty();
    }
  };

  const handleMedicationsKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Enter" && medicationsInput.trim()) {
      e.preventDefault();
      const val = medicationsInput.trim();
      if (!chronicMedications.includes(val)) {
        setChronicMedications([...chronicMedications, val]);
      }
      setMedicationsInput("");
      markDirty();
    }
  };

  const handleInterestsKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && interestsInput.trim()) {
      e.preventDefault();
      const val = interestsInput.trim();
      if (!interests.includes(val)) {
        setInterests([...interests, val]);
      }
      setInterestsInput("");
      markDirty();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    if (hasHeight && !isValidPatientHeight(heightCm.trim())) {
      setFormError(copy.invalidHeightFormat);
      return;
    }

    if (!isEditing && hasWeight && !isValidPatientWeight(weightKg.trim())) {
      setFormError(copy.invalidWeightFormat);
      return;
    }

    if (
      canManageDiscounts &&
      hasDiscount &&
      !isValidPatientDiscount(discountPercent.trim())
    ) {
      setFormError(copy.invalidDiscountFormat);
      return;
    }

    setFormError(null);
    setSubmitting(true);

    try {
      const abort = new AbortController();

      // Finalize tag inputs if anything was left typed
      let finalConditions = [...chronicConditions];
      if (conditionsInput.trim()) {
        finalConditions = Array.from(
          new Set([...finalConditions, conditionsInput.trim()]),
        );
      }

      let finalMedications = [...chronicMedications];
      if (medicationsInput.trim()) {
        finalMedications = Array.from(
          new Set([...finalMedications, medicationsInput.trim()]),
        );
      }

      let finalInterests = [...interests];
      if (interestsInput.trim()) {
        finalInterests = Array.from(
          new Set([...finalInterests, interestsInput.trim()]),
        );
      }

      const allergyString = hasAllergy
        ? allergiesList.length > 0
          ? allergiesList.join("، ")
          : copy.hasAllergy
        : null;
      const smokingString = isSmoker
        ? smokingNotes.trim() || copy.isSmoker
        : null;

      if (!isEditing) {
        // Create new patient
        const created = await createPatient(abort.signal, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          email: email.trim() || null,
          gender: gender ?? null,
          dateOfBirth: dateOfBirth || null,
          heightCm: heightCm.trim() || null,
          chronicConditions: finalConditions,
          chronicMedications: finalMedications,
          interests: finalInterests,
        });

        let currentUpdatedAt = created.updatedAt;
        let finalPatient = created;

        // Apply initial weight if entered
        if (weightKg.trim()) {
          await addPatientWeight(abort.signal, created.id, {
            weightKg: weightKg.trim(),
            measuredAt: new Date().toISOString(),
          });
          finalPatient = await getPatientProfile(abort.signal, created.id);
          currentUpdatedAt = finalPatient.updatedAt;
        }

        // Apply notes if provided and authorized
        if (canManageNotes && (otherNotes || allergyString || smokingString)) {
          const notesRes = await updatePatientNotes(abort.signal, created.id, {
            allergies: allergyString,
            smoking: smokingString,
            sensitivities: null,
            otherNotes: otherNotes.trim() || null,
            updatedAt: currentUpdatedAt,
          });
          currentUpdatedAt = notesRes.updatedAt;
          finalPatient = notesRes;
        }

        // Apply discount if provided and authorized
        if (canManageDiscounts && discountPercent.trim()) {
          const discountRes = await updatePatientDiscount(
            abort.signal,
            created.id,
            {
              discountPercent: discountPercent.trim() || null,
              updatedAt: currentUpdatedAt,
            },
          );
          currentUpdatedAt = discountRes.updatedAt;
          finalPatient = discountRes;
        }

        // Apply DND if enabled
        if (doNotDisturb) {
          const dndRes = await updatePatientDnd(abort.signal, created.id, {
            doNotDisturb: true,
            updatedAt: currentUpdatedAt,
          });
          finalPatient = dndRes;
        }

        onSaved(finalPatient);
      } else if (patient) {
        // Update existing patient with optimistic concurrency
        let currentUpdatedAt = patient.updatedAt;

        const profileRes = await updatePatientProfile(
          abort.signal,
          patient.id,
          {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phone: phone.trim() || null,
            address: address.trim() || null,
            email: email.trim() || null,
            gender: gender ?? null,
            dateOfBirth: dateOfBirth || null,
            heightCm: heightCm.trim() || null,
            chronicConditions: finalConditions,
            chronicMedications: finalMedications,
            interests: finalInterests,
            updatedAt: currentUpdatedAt,
          },
        );
        currentUpdatedAt = profileRes.updatedAt;
        let finalPatient = profileRes;

        if (canManageNotes) {
          const notesRes = await updatePatientNotes(abort.signal, patient.id, {
            allergies: allergyString,
            smoking: smokingString,
            sensitivities: patient.sensitivities ?? null,
            otherNotes: otherNotes.trim() || null,
            updatedAt: currentUpdatedAt,
          });
          currentUpdatedAt = notesRes.updatedAt;
          finalPatient = notesRes;
        }

        if (canManageDiscounts) {
          const discountRes = await updatePatientDiscount(
            abort.signal,
            patient.id,
            {
              discountPercent: discountPercent.trim() || null,
              updatedAt: currentUpdatedAt,
            },
          );
          currentUpdatedAt = discountRes.updatedAt;
          finalPatient = discountRes;
        }

        const dndRes = await updatePatientDnd(abort.signal, patient.id, {
          doNotDisturb,
          updatedAt: currentUpdatedAt,
        });
        finalPatient = dndRes;

        onSaved(finalPatient);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
        setFormError(copy.conflictError);
      } else {
        setFormError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="patient-edit-form"
      className="patient-profile patient-editor"
      dir="rtl"
    >
      {/* Top Header: Title + Actions (Prototype Layout) */}
      <div className="patient-profile-header">
        <h2 className="patient-profile-title">
          {isEditing
            ? `${firstName || (patient?.firstName ?? "")} ${lastName || (patient?.lastName ?? "")}`.trim() ||
              copy.editHeading
            : copy.createHeading}
        </h2>
        <div className="patient-header-actions">
          <button
            type="button"
            data-testid="edit-patient-button"
            className="btn-secondary"
            onClick={() => {}}
          >
            {copy.editProfile}
          </button>
          <button
            type="button"
            onClick={handleCancelClick}
            className="btn-secondary"
          >
            {copy.cancel}
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="save-patient-button"
            className="btn-primary"
          >
            {submitting ? copy.loading : isEditing ? copy.update : copy.save}
          </button>
        </div>
      </div>

      {formError && (
        <div className="denial-alert" role="alert">
          {formError}
        </div>
      )}

      {/* ROW 1: Identity level (12-column grid) */}
      <div className="patient-grid-layout">
        {/* Name (First + Last) */}
        <div className="patient-field col-span-3">
          <span className="patient-field-label">{copy.fullName} *</span>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            <input
              id="first-name-input"
              data-testid="input-first-name"
              required
              placeholder={copy.firstName}
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                markDirty();
              }}
              className="patient-field-input"
              style={{ flex: 1, minWidth: 0 }}
            />
            <input
              id="last-name-input"
              data-testid="input-last-name"
              required
              placeholder={copy.lastName}
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                markDirty();
              }}
              className="patient-field-input"
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
        </div>

        {/* Phone */}
        <div className="patient-field col-span-2">
          <label htmlFor="phone-input" className="patient-field-label">
            {copy.phone}
          </label>
          <input
            id="phone-input"
            data-testid="input-phone"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              markDirty();
            }}
            className="patient-field-input font-mono"
          />
        </div>

        {/* Address */}
        <div className="patient-field col-span-3">
          <label htmlFor="address-input" className="patient-field-label">
            {copy.address}
          </label>
          <input
            id="address-input"
            data-testid="input-address"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              markDirty();
            }}
            className="patient-field-input"
          />
        </div>

        {/* Gender toggles */}
        <div className="patient-field col-span-2">
          <span className="patient-field-label">{copy.gender}</span>
          <div className="gender-toggle-group">
            <button
              type="button"
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

        {/* DOB / Age */}
        <div className="patient-field col-span-2">
          <label htmlFor="dob-input" className="patient-field-label">
            {copy.dateOfBirth} / {copy.age}
          </label>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            <input
              id="dob-input"
              type="date"
              value={dateOfBirth}
              onChange={(e) => {
                setDateOfBirth(e.target.value);
                markDirty();
              }}
              className="patient-field-input"
              style={{ flex: 1, minWidth: 0 }}
            />
            <div className="patient-age-badge font-mono">
              {computedAge !== null ? `${computedAge}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* ROW 2: Biometrics level (12-column grid, items-end) */}
      <div className="patient-grid-layout" style={{ alignItems: "flex-end" }}>
        {/* Height (cm) */}
        <div className="patient-field col-span-3">
          <label htmlFor="height-input" className="patient-field-label">
            {copy.heightCm}
          </label>
          <input
            id="height-input"
            data-testid="input-height"
            type="text"
            inputMode="decimal"
            placeholder={copy.heightCm}
            value={heightCm}
            aria-invalid={!isHeightValid}
            onChange={(e) => {
              setHeightCm(e.target.value);
              markDirty();
            }}
            className="patient-field-input font-mono"
          />
          {!isHeightValid && hasHeight && (
            <div className="patient-field-error" role="alert">
              {copy.invalidHeightFormat}
            </div>
          )}
        </div>

        {/* Weight with inline history dropdown */}
        {patient ? (
          <InlineWeightInput
            patientId={patient.id}
            weights={weights}
            onWeightAdded={onWeightAdded}
            canManage={true}
          />
        ) : (
          <div className="patient-field col-span-7">
            <label htmlFor="input-weight" className="patient-field-label">
              {copy.weightKg}
            </label>
            <div className="inline-weight-row">
              <input
                id="input-weight"
                data-testid="input-weight"
                type="text"
                inputMode="decimal"
                value={weightKg}
                aria-invalid={!isWeightValid}
                onChange={(e) => {
                  setWeightKg(e.target.value);
                  markDirty();
                }}
                placeholder={copy.weightKg}
                className="patient-field-input font-mono"
              />
            </div>
            {!isWeightValid && hasWeight && (
              <div className="patient-field-error" role="alert">
                {copy.invalidWeightFormat}
              </div>
            )}
          </div>
        )}

        {/* BMI Card */}
        <BmiCard patient={{ bmi: previewBmi, heightCm }} />
      </div>

      {/* Secondary fields: Discount & Email if present or authorized */}
      {(canManageDiscounts || email || isEditing) && (
        <div className="patient-grid-layout" style={{ alignItems: "flex-end" }}>
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
                placeholder="0.00"
                value={discountPercent}
                aria-invalid={!isDiscountValid}
                onChange={(e) => {
                  setDiscountPercent(e.target.value);
                  markDirty();
                }}
                className="patient-field-input font-mono"
              />
              {!isDiscountValid && hasDiscount && (
                <div className="patient-field-error" role="alert">
                  {copy.invalidDiscountFormat}
                </div>
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
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                markDirty();
              }}
              className="patient-field-input"
            />
          </div>
        </div>
      )}

      {/* ROW 3: Tags (3 equal columns: col-span-4 each) */}
      <div className="patient-grid-layout">
        {/* Chronic Conditions (Rose Tone) */}
        <div className="patient-field col-span-4">
          <label htmlFor="conditions-input" className="patient-field-label">
            {copy.chronicConditions}
          </label>
          <div className="tag-field-container">
            {chronicConditions.map((cond, idx) => (
              <span key={`${cond}-${idx}`} className="tag-chip tag-chip-rose">
                {cond}
                <button
                  type="button"
                  onClick={() => {
                    setChronicConditions(
                      chronicConditions.filter((_, i) => i !== idx),
                    );
                    markDirty();
                  }}
                  className="tag-chip-remove"
                  aria-label={`${copy.removeItem} ${cond}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              id="conditions-input"
              data-testid="input-conditions"
              value={conditionsInput}
              onChange={handleConditionsChange}
              onKeyDown={handleConditionsKeyDown}
              placeholder={copy.addConditionPlaceholder}
              className="tag-field-input"
            />
          </div>
        </div>

        {/* Chronic Medications (Emerald Tone) */}
        <div className="patient-field col-span-4">
          <label htmlFor="medications-input" className="patient-field-label">
            {copy.chronicMedications}
          </label>
          <div className="tag-field-container">
            {chronicMedications.map((med, idx) => (
              <span key={`${med}-${idx}`} className="tag-chip tag-chip-emerald">
                {med}
                <button
                  type="button"
                  onClick={() => {
                    setChronicMedications(
                      chronicMedications.filter((_, i) => i !== idx),
                    );
                    markDirty();
                  }}
                  className="tag-chip-remove"
                  aria-label={`${copy.removeItem} ${med}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              id="medications-input"
              value={medicationsInput}
              onChange={(e) => {
                setMedicationsInput(e.target.value);
                markDirty();
              }}
              onKeyDown={handleMedicationsKeyDown}
              placeholder={copy.addMedicationPlaceholder}
              className="tag-field-input"
            />
          </div>
        </div>

        {/* Interests (Amber Tone) */}
        <div className="patient-field col-span-4">
          <label htmlFor="interests-input" className="patient-field-label">
            {copy.interests}
          </label>
          <div className="tag-field-container">
            {interests.map((interest, idx) => (
              <span
                key={`${interest}-${idx}`}
                className="tag-chip tag-chip-amber"
              >
                {interest}
                <button
                  type="button"
                  onClick={() => {
                    setInterests(interests.filter((_, i) => i !== idx));
                    markDirty();
                  }}
                  className="tag-chip-remove"
                  aria-label={`${copy.removeItem} ${interest}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              id="interests-input"
              value={interestsInput}
              onChange={(e) => {
                setInterestsInput(e.target.value);
                markDirty();
              }}
              onKeyDown={handleInterestsKeyDown}
              placeholder={copy.addInterestPlaceholder}
              className="tag-field-input"
            />
          </div>
        </div>
      </div>

      {/* ROW 4: Notes + Lifestyle / Medical Toggles (12-column grid, items-start) */}
      <div className="patient-grid-layout" style={{ alignItems: "flex-start" }}>
        {/* Notes (Authorized via patients.notes.manage) */}
        {canManageNotes && (
          <div className="patient-field col-span-7">
            <label htmlFor="notes-textarea" className="patient-field-label">
              {copy.otherNotes}
            </label>
            <textarea
              id="notes-textarea"
              data-testid="input-notes"
              rows={3}
              value={otherNotes}
              onChange={(e) => {
                setOtherNotes(e.target.value);
                markDirty();
              }}
              className="patient-field-textarea"
            />
          </div>
        )}

        {/* Lifestyle & Medical Indicators (col-span-5) */}
        <div
          className={`patient-field ${canManageNotes ? "col-span-5" : "col-span-12"}`}
        >
          <span className="patient-field-label">
            {copy.lifestyleAndMedical}
          </span>
          <div className="prototype-toggle-row">
            {/* Smoker Toggle */}
            <button
              type="button"
              onClick={() => {
                setIsSmoker(!isSmoker);
                markDirty();
              }}
              className={`patient-toggle-btn ${isSmoker ? "active" : ""}`}
            >
              <span>{copy.isSmoker}</span>
              <span
                className={`patient-toggle-track ${isSmoker ? "active" : ""}`}
              >
                <span
                  className="patient-toggle-thumb"
                  style={{
                    insetInlineStart: isSmoker ? "1.125rem" : "0.125rem",
                  }}
                />
              </span>
            </button>

            {/* DND Toggle */}
            <label
              className={`patient-toggle-btn ${doNotDisturb ? "active" : ""}`}
              style={{ cursor: "pointer", position: "relative" }}
            >
              <span style={{ pointerEvents: "none" }}>{copy.dnd}</span>
              <input
                data-testid="input-dnd"
                type="checkbox"
                checked={doNotDisturb}
                onChange={(e) => {
                  setDoNotDisturb(e.target.checked);
                  markDirty();
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  cursor: "pointer",
                  zIndex: 1,
                }}
              />
              <span
                className={`patient-toggle-track ${doNotDisturb ? "active" : ""}`}
                style={{ pointerEvents: "none" }}
              >
                <span
                  className="patient-toggle-thumb"
                  style={{
                    insetInlineStart: doNotDisturb ? "1.125rem" : "0.125rem",
                  }}
                />
              </span>
            </label>

            {/* Allergy Toggle */}
            <button
              type="button"
              data-testid="input-allergy-toggle"
              onClick={() => {
                const next = !hasAllergy;
                setHasAllergy(next);
                markDirty();
              }}
              className={`patient-toggle-btn ${hasAllergy ? "active" : ""}`}
            >
              <span>{copy.hasAllergy}</span>
              <span
                className={`patient-toggle-track ${hasAllergy ? "active" : ""}`}
              >
                <span
                  className="patient-toggle-thumb"
                  style={{
                    insetInlineStart: hasAllergy ? "1.125rem" : "0.125rem",
                  }}
                />
              </span>
            </button>
          </div>

          {/* Smoking Details (if smoker) */}
          {isSmoker && (
            <div className="patient-smoking-details">
              <input
                value={smokingNotes}
                onChange={(e) => {
                  setSmokingNotes(e.target.value);
                  markDirty();
                }}
                placeholder={copy.smoking}
                className="patient-field-input patient-subfield-input"
              />
            </div>
          )}

          {/* Allergy Picker */}
          {hasAllergy && (
            <AllergyPicker
              value={allergiesList}
              onChange={(newList) => {
                setAllergiesList(newList);
                markDirty();
              }}
            />
          )}
        </div>
      </div>
    </form>
  );
}
