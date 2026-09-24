import { useState, useEffect, useCallback } from "react";
import type {
  PatientProfileResponse,
  PatientWeightMeasurementResponse,
} from "@breev/contracts/local-rest";
import { formatCanonicalDecimal } from "../lib/exact-decimal";
import { useIdentityState } from "../identity-state-provider";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";
import {
  archivePatient,
  getPatientProfile,
  listPatientWeights,
  restorePatient,
  PatientsApiDenied,
} from "./patient-api";
import { PatientForm, ageFromDob } from "./patient-form";
import {
  BmiCard,
  InlineWeightInput,
  WeightHistorySection,
} from "./weight-history";

export function PatientProfileView({
  patientId,
  onProfileUpdated,
}: {
  readonly patientId: string;
  readonly onProfileUpdated?: () => void;
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];

  const { state: identity } = useIdentityState();
  const authenticated = identity?.state === "authenticated";
  const canManage =
    authenticated && identity.allowedPermissions.includes("patients.manage");
  const canManageNotes =
    authenticated &&
    identity.allowedPermissions.includes("patients.notes.manage");
  const canManageDiscounts =
    authenticated &&
    identity.allowedPermissions.includes("patients.discounts.manage");

  const [patient, setPatient] = useState<PatientProfileResponse | null>(null);
  const [weights, setWeights] = useState<PatientWeightMeasurementResponse[]>(
    [],
  );
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const abort = new AbortController();
      const [p, w] = await Promise.all([
        getPatientProfile(abort.signal, patientId),
        listPatientWeights(abort.signal, patientId, 1, 50),
      ]);
      setPatient(p);
      setWeights(w.items);
    } catch (e) {
      if (e instanceof PatientsApiDenied) {
        setLoadError(copy.permissionDenied);
      } else {
        setLoadError(e instanceof Error ? e.message : "Failed to load patient");
      }
    } finally {
      setLoading(false);
    }
  }, [patientId, copy.permissionDenied]);

  const handleArchive = async () => {
    if (!patient) return;
    setArchiving(true);
    try {
      const abort = new AbortController();
      await archivePatient(abort.signal, patient.id, patient.updatedAt);
      setConfirmingArchive(false);
      onProfileUpdated?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to archive patient");
    } finally {
      setArchiving(false);
    }
  };

  const handleRestore = async () => {
    if (!patient) return;
    setRestoring(true);
    try {
      const abort = new AbortController();
      await restorePatient(abort.signal, patient.id, patient.updatedAt);
      void loadProfile();
      onProfileUpdated?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to restore patient");
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  if (loadError) {
    return (
      <div className="denial-alert" role="status" aria-live="polite">
        {loadError}
      </div>
    );
  }

  if (loading || !patient) {
    return (
      <div
        aria-live="polite"
        style={{
          padding: "2rem",
          textAlign: "center",
          color: "var(--muted-foreground)",
        }}
      >
        {copy.loading}
      </div>
    );
  }

  if (editing) {
    return (
      <PatientForm
        patient={patient}
        weights={weights}
        onWeightAdded={loadProfile}
        onSaved={() => {
          setEditing(false);
          void loadProfile();
          onProfileUpdated?.();
        }}
        onCancel={() => setEditing(false)}
        canManageNotes={canManageNotes}
        canManageDiscounts={canManageDiscounts}
      />
    );
  }

  const computedAge = ageFromDob(patient.dateOfBirth);

  const allergiesArray = patient.allergies
    ? patient.allergies
        .split(/[,،]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return (
    <div
      className="patient-profile"
      data-testid="patient-profile-view"
      dir="rtl"
    >
      {/* Top Header: Title + Actions (Prototype Layout) */}
      <div className="patient-profile-header">
        <div className="patient-title-group">
          <h2 className="patient-profile-title">
            {patient.firstName} {patient.lastName}
          </h2>
          {patient.gender && (
            <span className="patient-badge patient-badge-emerald">
              {patient.gender === "male" ? copy.male : copy.female}
            </span>
          )}
          {computedAge !== null && (
            <span className="patient-badge patient-badge-age">
              {computedAge} {copy.years}
            </span>
          )}
          {patient.doNotDisturb && (
            <span className="patient-badge patient-badge-rose">{copy.dnd}</span>
          )}
        </div>

        {canManage && (
          <div className="patient-header-actions">
            {!patient.archivedAt && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                data-testid="edit-patient-button"
                className="btn-primary"
              >
                {copy.editProfile}
              </button>
            )}
            {patient.archivedAt ? (
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoring}
                data-testid="restore-patient-button"
                className="btn-primary"
              >
                {restoring ? copy.loading : copy.restorePatient}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingArchive(true)}
                data-testid="delete-patient-button"
                className="btn-destructive-outline"
              >
                {copy.deletePatient}
              </button>
            )}
          </div>
        )}
      </div>

      {patient.archivedAt && (
        <div className="patient-archived-banner" role="status">
          {copy.patientArchived}
        </div>
      )}

      {confirmingArchive && (
        <div
          className="modal-overlay"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            className="patient-card"
            style={{
              maxWidth: "400px",
              width: "100%",
              padding: "1.5rem",
              background: "var(--background, #ffffff)",
              borderRadius: "0.5rem",
              boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: "0.75rem" }}>
              {copy.archiveConfirmTitle}
            </h3>
            <p
              style={{
                fontSize: "0.875rem",
                color: "var(--muted-foreground)",
                marginBottom: "1.25rem",
              }}
            >
              {copy.archiveConfirmMessage(
                `${patient.firstName} ${patient.lastName}`,
              )}
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.5rem",
              }}
            >
              <button
                className="btn-secondary"
                onClick={() => setConfirmingArchive(false)}
                disabled={archiving}
              >
                {copy.cancel}
              </button>
              <button
                className="btn-destructive"
                style={{
                  backgroundColor: "#e11d48",
                  color: "#ffffff",
                  border: "none",
                  padding: "0.5rem 1rem",
                  borderRadius: "0.375rem",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
                onClick={handleArchive}
                disabled={archiving}
                data-testid="confirm-archive-patient-button"
              >
                {archiving ? copy.loading : copy.deletePatient}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ROW 1: Identity level (12-column grid, Prototype Layout) */}
      <div className="patient-grid-layout">
        {/* Name */}
        <div className="patient-field col-span-3">
          <span className="patient-field-label">{copy.fullName}</span>
          <div className="patient-field-value font-bold">
            {patient.firstName} {patient.lastName}
          </div>
        </div>

        {/* Phone */}
        <div className="patient-field col-span-2">
          <span className="patient-field-label">{copy.phone}</span>
          <strong
            data-testid="view-phone"
            className="patient-field-value font-mono"
          >
            {patient.phone ?? copy.notSet}
          </strong>
        </div>

        {/* Address */}
        <div className="patient-field col-span-3">
          <span className="patient-field-label">{copy.address}</span>
          <div className="patient-field-value">
            {patient.address ?? copy.notSet}
          </div>
        </div>

        {/* Gender */}
        <div className="patient-field col-span-2">
          <span className="patient-field-label">{copy.gender}</span>
          <div className="gender-toggle-group">
            <button
              type="button"
              disabled
              className={`gender-toggle-btn ${patient.gender === "male" ? "active" : ""}`}
            >
              {copy.male}
            </button>
            <button
              type="button"
              disabled
              className={`gender-toggle-btn ${patient.gender === "female" ? "active" : ""}`}
            >
              {copy.female}
            </button>
          </div>
        </div>

        {/* DOB / Age */}
        <div className="patient-field col-span-2">
          <span className="patient-field-label">
            {copy.dateOfBirth} / {copy.age}
          </span>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            <div className="patient-field-value font-mono" style={{ flex: 1 }}>
              {patient.dateOfBirth ?? copy.notSet}
            </div>
            <div className="patient-age-badge font-mono">
              {computedAge !== null ? `${computedAge}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* ROW 2: Biometrics level (12-column grid, items-end, Prototype Layout) */}
      <div className="patient-grid-layout" style={{ alignItems: "flex-end" }}>
        {/* Height (cm) */}
        <div className="patient-field col-span-3">
          <span className="patient-field-label">{copy.heightCm}</span>
          <div className="patient-field-value font-mono">
            <strong data-testid="view-height">
              {patient.heightCm ? formatCanonicalDecimal(patient.heightCm) : ""}
            </strong>
            {patient.heightCm && <span> cm</span>}
            {!patient.heightCm && <span>{copy.notSet}</span>}
          </div>
        </div>

        {/* Weight with inline history dropdown & add input */}
        <InlineWeightInput
          patientId={patient.id}
          weights={weights}
          onWeightAdded={loadProfile}
          canManage={canManage}
        />

        {/* BMI Card */}
        <BmiCard patient={patient} />
      </div>

      {/* Secondary commercial fields: Discount, DND, Email */}
      {(canManageDiscounts || patient.email || patient.discountPercent) && (
        <div className="patient-grid-layout" style={{ alignItems: "flex-end" }}>
          {canManageDiscounts && (
            <div className="patient-field col-span-3">
              <span className="patient-field-label">
                {copy.discountPercent} (%)
              </span>
              <div className="patient-field-value font-mono">
                <strong data-testid="view-discount">
                  {formatCanonicalDecimal(patient.discountPercent)}
                </strong>
                <span>%</span>
              </div>
            </div>
          )}

          <div className="patient-field col-span-2">
            <span className="patient-field-label">{copy.dnd}</span>
            <div className="patient-field-value">
              <strong data-testid="view-dnd">
                {patient.doNotDisturb ? "Yes" : "No"}
              </strong>
            </div>
          </div>

          {patient.email && (
            <div className="patient-field col-span-4">
              <span className="patient-field-label">{copy.email}</span>
              <div className="patient-field-value">{patient.email}</div>
            </div>
          )}
        </div>
      )}

      {/* ROW 3: Tags (3 equal columns: col-span-4 each, Prototype Layout) */}
      <div className="patient-grid-layout">
        {/* Chronic Conditions (Rose Tone) */}
        <div className="patient-field col-span-4">
          <span className="patient-field-label">{copy.chronicConditions}</span>
          <ul
            data-testid="view-conditions"
            className="tag-field-container"
            style={{ listStyle: "none", margin: 0 }}
          >
            {(patient.chronicConditions ?? []).length === 0 ? (
              <li
                style={{
                  color: "var(--muted-foreground)",
                  fontSize: "0.75rem",
                }}
              >
                {copy.notSet}
              </li>
            ) : (
              (patient.chronicConditions ?? []).map((c) => (
                <li key={c} className="tag-chip tag-chip-rose">
                  {c}
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Chronic Medications (Emerald Tone) */}
        <div className="patient-field col-span-4">
          <span className="patient-field-label">{copy.chronicMedications}</span>
          <ul
            className="tag-field-container"
            style={{ listStyle: "none", margin: 0 }}
          >
            {(patient.chronicMedications ?? []).length === 0 ? (
              <li
                style={{
                  color: "var(--muted-foreground)",
                  fontSize: "0.75rem",
                }}
              >
                {copy.notSet}
              </li>
            ) : (
              (patient.chronicMedications ?? []).map((m) => (
                <li key={m} className="tag-chip tag-chip-emerald">
                  {m}
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Interests (Amber Tone) */}
        <div className="patient-field col-span-4">
          <span className="patient-field-label">{copy.interests}</span>
          <ul
            className="tag-field-container"
            style={{ listStyle: "none", margin: 0 }}
          >
            {(patient.interests ?? []).length === 0 ? (
              <li
                style={{
                  color: "var(--muted-foreground)",
                  fontSize: "0.75rem",
                }}
              >
                {copy.notSet}
              </li>
            ) : (
              (patient.interests ?? []).map((item) => (
                <li key={item} className="tag-chip tag-chip-amber">
                  {item}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {/* ROW 4: Notes + Lifestyle / Medical indicators (12-column grid, items-start) */}
      <div className="patient-grid-layout" style={{ alignItems: "flex-start" }}>
        {/* Notes (Authorized via patients.notes.manage) */}
        {canManageNotes && (
          <div className="patient-field col-span-7">
            <span className="patient-field-label">{copy.otherNotes}</span>
            <p
              data-testid="view-notes"
              className="patient-field-value pre-wrap"
              style={{
                minHeight: "5.5rem",
                margin: 0,
                color: patient.otherNotes
                  ? "var(--foreground)"
                  : "var(--muted-foreground)",
              }}
            >
              {patient.otherNotes || copy.notSet}
            </p>
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
            {/* Smoker Indicator */}
            <div
              className={`patient-toggle-btn ${patient.smoking ? "active" : ""}`}
            >
              <span>{copy.isSmoker}</span>
              <span
                className={`patient-toggle-track ${patient.smoking ? "active" : ""}`}
              >
                <span
                  className="patient-toggle-thumb"
                  style={{
                    insetInlineStart: patient.smoking ? "1.125rem" : "0.125rem",
                  }}
                />
              </span>
            </div>

            {/* DND Indicator */}
            <div
              className={`patient-toggle-btn ${patient.doNotDisturb ? "active" : ""}`}
            >
              <span>{copy.dnd}</span>
              <span
                className={`patient-toggle-track ${patient.doNotDisturb ? "active" : ""}`}
              >
                <span
                  className="patient-toggle-thumb"
                  style={{
                    insetInlineStart: patient.doNotDisturb
                      ? "1.125rem"
                      : "0.125rem",
                  }}
                />
              </span>
            </div>

            {/* Allergy Indicator (Read-only in view mode) */}
            <div
              className={`patient-toggle-btn ${allergiesArray.length > 0 ? "active" : ""}`}
              data-testid="view-allergy-toggle"
              aria-label={copy.hasAllergy}
            >
              <span>{copy.hasAllergy}</span>
              <span
                className={`patient-toggle-track ${allergiesArray.length > 0 ? "active" : ""}`}
              >
                <span
                  className="patient-toggle-thumb"
                  style={{
                    insetInlineStart:
                      allergiesArray.length > 0 ? "1.125rem" : "0.125rem",
                  }}
                />
              </span>
            </div>
          </div>

          {/* Smoking text if present */}
          {patient.smoking && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--muted-foreground)",
                marginTop: "0.375rem",
              }}
            >
              {patient.smoking}
            </div>
          )}

          {/* Allergies list if present (Read-only tags in profile view) */}
          {allergiesArray.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.375rem",
                marginTop: "0.5rem",
              }}
            >
              {allergiesArray.map((allg, idx) => (
                <span key={`${allg}-${idx}`} className="tag-chip tag-chip-rose">
                  {allg}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cumulative Weight History Table (Full section) */}
      <WeightHistorySection weights={weights} />
    </div>
  );
}
