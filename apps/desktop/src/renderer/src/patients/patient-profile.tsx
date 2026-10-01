import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  PatientProfileResponse,
  PatientWeightMeasurementResponse,
} from "@breev/contracts/local-rest";
import { formatCanonicalDecimal } from "../lib/exact-decimal";
import { useCommittedFocus } from "../committed-focus";
import { directionForLocale } from "../preferences";
import { useIdentityState } from "../identity-state-provider";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";
import {
  getPatientProfile,
  listPatientWeights,
  PatientsApiDenied,
  PatientsApiNotFound,
} from "./patient-api";
import { PatientForm, ageFromDob } from "./patient-form";
import { patientAllergyLabel } from "./allergy-picker";
import {
  BmiCard,
  InlineWeightInput,
  WeightHistorySection,
} from "./weight-history";

type ProfileLoadFailure = "denied" | "missing" | "unavailable";

export function PatientProfileView({
  patientId,
  onProfileUpdated,
  focusOnLoad = true,
}: {
  readonly patientId: string;
  readonly onProfileUpdated?: () => void;
  readonly focusOnLoad?: boolean;
}) {
  const { locale } = usePreferences();
  const copy = patientMessages[locale];
  const { state: identity } = useIdentityState();
  const permissions =
    identity?.state === "authenticated" ? identity.allowedPermissions : [];
  const canManage = permissions.includes("patients.manage");
  const canManageNotes = permissions.includes("patients.notes.manage");
  const canViewNotes =
    canManageNotes || permissions.includes("patients.notes.view");
  const canManageDiscounts = permissions.includes("patients.discounts.manage");

  const [patient, setPatient] = useState<PatientProfileResponse | null>(null);
  const [weights, setWeights] = useState<PatientWeightMeasurementResponse[]>(
    [],
  );
  const [businessTimeZone, setBusinessTimeZone] = useState("");
  const [weightPage, setWeightPage] = useState(1);
  const [weightTotalPages, setWeightTotalPages] = useState(1);
  const [weightLoading, setWeightLoading] = useState(false);
  const [weightLoadError, setWeightLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<ProfileLoadFailure | null>(
    null,
  );
  const profileAbortRef = useRef<AbortController | null>(null);
  const profileSequenceRef = useRef(0);
  const weightAbortRef = useRef<AbortController | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const profileHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusedPatientIdRef = useRef<string | null>(null);
  const requestCommittedFocus = useCommittedFocus();

  const loadProfile = useCallback(async () => {
    profileAbortRef.current?.abort();
    weightAbortRef.current?.abort();
    const abort = new AbortController();
    profileAbortRef.current = abort;
    const sequence = ++profileSequenceRef.current;
    setLoading(true);
    setLoadFailure(null);
    setWeightLoadError(false);
    setWeightLoading(false);
    setWeightPage(1);
    try {
      const [profile, history] = await Promise.all([
        getPatientProfile(abort.signal, patientId),
        listPatientWeights(abort.signal, patientId, 1, 50),
      ]);
      if (abort.signal.aborted || sequence !== profileSequenceRef.current)
        return;
      setPatient(profile);
      setWeights(history.items);
      setWeightPage(history.page);
      setWeightTotalPages(Math.max(1, history.totalPages));
      setBusinessTimeZone(history.businessTimeZone);
    } catch (error) {
      if (abort.signal.aborted || sequence !== profileSequenceRef.current)
        return;
      setLoadFailure(
        error instanceof PatientsApiDenied
          ? "denied"
          : error instanceof PatientsApiNotFound
            ? "missing"
            : "unavailable",
      );
    } finally {
      if (sequence === profileSequenceRef.current) {
        setLoading(false);
        profileAbortRef.current = null;
      }
    }
  }, [patientId]);

  useEffect(() => {
    setPatient(null);
    setWeights([]);
    setBusinessTimeZone("");
    void loadProfile();
    return () => {
      profileSequenceRef.current += 1;
      profileAbortRef.current?.abort();
      weightAbortRef.current?.abort();
    };
  }, [loadProfile]);

  useLayoutEffect(() => {
    if (
      loading ||
      !focusOnLoad ||
      patient?.id !== patientId ||
      focusedPatientIdRef.current === patientId
    ) {
      return;
    }
    focusedPatientIdRef.current = patientId;
    requestCommittedFocus(() =>
      canManage ? editButtonRef.current : profileHeadingRef.current,
    );
  }, [
    canManage,
    focusOnLoad,
    loading,
    patient?.id,
    patientId,
    requestCommittedFocus,
  ]);

  const loadMoreWeights = useCallback(async () => {
    if (
      !patient ||
      weightLoading ||
      (!weightLoadError && weightPage >= weightTotalPages)
    ) {
      return;
    }
    const page = weightPage + 1;
    weightAbortRef.current?.abort();
    const abort = new AbortController();
    weightAbortRef.current = abort;
    const profileSequence = profileSequenceRef.current;
    setWeightLoading(true);
    setWeightLoadError(false);
    try {
      const result = await listPatientWeights(
        abort.signal,
        patientId,
        page,
        50,
      );
      if (
        abort.signal.aborted ||
        profileSequence !== profileSequenceRef.current
      )
        return;
      setWeights((current) => {
        const known = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...result.items.filter((item) => !known.has(item.id)),
        ];
      });
      setWeightPage(result.page);
      setWeightTotalPages(Math.max(1, result.totalPages));
      setBusinessTimeZone((current) => current || result.businessTimeZone);
    } catch {
      if (
        abort.signal.aborted ||
        profileSequence !== profileSequenceRef.current
      )
        return;
      setWeightLoadError(true);
    } finally {
      if (profileSequence === profileSequenceRef.current) {
        setWeightLoading(false);
        weightAbortRef.current = null;
      }
    }
  }, [
    patient,
    patientId,
    weightLoadError,
    weightLoading,
    weightPage,
    weightTotalPages,
  ]);

  const beginEditing = () => {
    setEditing(true);
    requestCommittedFocus(() => document.getElementById("first-name-input"));
  };

  const leaveEditing = () => {
    setEditing(false);
    requestCommittedFocus(() => editButtonRef.current);
  };

  const handleSaved = (saved: PatientProfileResponse) => {
    setPatient(saved);
    leaveEditing();
    void loadProfile();
    onProfileUpdated?.();
  };

  if (loading && (patient === null || patient.id !== patientId)) {
    return (
      <p className="patient-profile-status" role="status" aria-live="polite">
        {copy.loading}
      </p>
    );
  }

  if (patient === null || patient.id !== patientId) {
    return (
      <div className="patients-denied-panel" dir={directionForLocale(locale)}>
        <p className="denial-alert" role="alert" aria-live="assertive">
          {loadFailure === "denied"
            ? copy.permissionDenied
            : loadFailure === "missing"
              ? copy.profileNotFound
              : copy.profileLoadError}
        </p>
        {loadFailure !== "denied" && (
          <button
            type="button"
            className="btn-outline"
            onClick={() => void loadProfile()}
          >
            {copy.retryAction}
          </button>
        )}
      </div>
    );
  }

  const computedAge = ageFromDob(patient.dateOfBirth);
  const allergiesArray = (canViewNotes ? patient.allergies : undefined)
    ? patient
        .allergies!.split(/[,،]/u)
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const smoking = canViewNotes ? patient.smoking : undefined;
  const notes = canViewNotes ? patient.otherNotes : undefined;
  const sensitivities = canViewNotes ? patient.sensitivities : undefined;
  const conditions = canViewNotes ? (patient.chronicConditions ?? []) : [];
  const medications = canViewNotes ? (patient.chronicMedications ?? []) : [];

  if (editing) {
    return (
      <PatientForm
        patient={patient}
        weights={weights}
        businessTimeZone={businessTimeZone}
        onSaved={handleSaved}
        onCancel={leaveEditing}
        canManageNotes={canManageNotes}
        canManageDiscounts={canManageDiscounts}
      />
    );
  }

  return (
    <div
      className="patient-profile"
      data-testid="patient-profile-view"
      dir={directionForLocale(locale)}
      aria-busy={loading}
    >
      {loadFailure && (
        <div className="patient-profile-load-error" role="alert">
          <p>
            {loadFailure === "denied"
              ? copy.permissionDenied
              : loadFailure === "missing"
                ? copy.profileNotFound
                : copy.profileLoadError}
          </p>
          {loadFailure !== "denied" && (
            <button
              type="button"
              className="btn-outline"
              onClick={() => void loadProfile()}
            >
              {copy.retryAction}
            </button>
          )}
        </div>
      )}
      <div className="patient-profile-header">
        <div className="patient-title-group">
          <h2
            ref={profileHeadingRef}
            className="patient-profile-title"
            tabIndex={-1}
          >
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
            <button
              ref={editButtonRef}
              type="button"
              onClick={beginEditing}
              data-testid="edit-patient-button"
              className="btn-primary"
            >
              {copy.editProfile}
            </button>
          </div>
        )}
      </div>

      <div className="patient-grid-layout">
        <div className="patient-field col-span-3">
          <span className="patient-field-label">{copy.fullName}</span>
          <div className="patient-field-value font-bold">
            {patient.firstName} {patient.lastName}
          </div>
        </div>
        <div className="patient-field col-span-2">
          <span className="patient-field-label">{copy.phone}</span>
          <strong
            data-testid="view-phone"
            className="patient-field-value font-mono"
          >
            {patient.phone ?? copy.notSet}
          </strong>
        </div>
        <div className="patient-field col-span-3">
          <span className="patient-field-label">{copy.address}</span>
          <div className="patient-field-value">
            {patient.address ?? copy.notSet}
          </div>
        </div>
        <div className="patient-field col-span-2">
          <span className="patient-field-label">{copy.gender}</span>
          <div className="patient-field-value">
            {patient.gender === "male"
              ? copy.male
              : patient.gender === "female"
                ? copy.female
                : copy.notSet}
          </div>
        </div>
        <div className="patient-field col-span-2">
          <span className="patient-field-label">
            {copy.dateOfBirth} / {copy.age}
          </span>
          <div className="patient-dob-row">
            <span className="patient-field-value font-mono">
              {patient.dateOfBirth ?? copy.notSet}
            </span>
            <span className="patient-age-badge font-mono">
              {computedAge ?? copy.notSet}
            </span>
          </div>
        </div>
      </div>

      <div className="patient-grid-layout patient-biometric-row">
        <div className="patient-field col-span-3">
          <span className="patient-field-label">{copy.heightCm}</span>
          <div className="patient-field-value font-mono">
            <strong data-testid="view-height">
              {patient.heightCm
                ? formatCanonicalDecimal(patient.heightCm)
                : copy.notSet}
            </strong>
            {patient.heightCm && <span> cm</span>}
          </div>
        </div>
        <InlineWeightInput
          patient={{ id: patient.id, revision: patient.revision }}
          weights={weights}
          businessTimeZone={businessTimeZone}
          onWeightAdded={loadProfile}
          onConflict={loadProfile}
          canManage={canManage}
        />
        <BmiCard patient={patient} />
      </div>

      <div className="patient-grid-layout">
        {canManageDiscounts && (
          <div className="patient-field col-span-3">
            <span className="patient-field-label">
              {copy.discountPercent} (%)
            </span>
            <div className="patient-field-value font-mono">
              <strong data-testid="view-discount">
                {patient.discountPercent === null
                  ? copy.notSet
                  : formatCanonicalDecimal(patient.discountPercent)}
              </strong>
              {patient.discountPercent !== null && <span>%</span>}
            </div>
          </div>
        )}
        <div className="patient-field col-span-2">
          <span className="patient-field-label">{copy.dnd}</span>
          <strong data-testid="view-dnd" className="patient-field-value">
            {patient.doNotDisturb ? copy.dndEnabled : copy.dndDisabled}
          </strong>
        </div>
        {patient.email && (
          <div className="patient-field col-span-4">
            <span className="patient-field-label">{copy.email}</span>
            <div className="patient-field-value">{patient.email}</div>
          </div>
        )}
      </div>

      <div className="patient-grid-layout">
        {canViewNotes && (
          <div className="patient-field col-span-4">
            <span className="patient-field-label">
              {copy.chronicConditions}
            </span>
            <ul data-testid="view-conditions" className="tag-field-container">
              {conditions.length === 0 ? (
                <li className="patient-tag-empty">{copy.notSet}</li>
              ) : (
                conditions.map((condition) => (
                  <li key={condition} className="tag-chip tag-chip-rose">
                    {condition}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
        {canViewNotes && (
          <div className="patient-field col-span-4">
            <span className="patient-field-label">
              {copy.chronicMedications}
            </span>
            <ul className="tag-field-container">
              {medications.length === 0 ? (
                <li className="patient-tag-empty">{copy.notSet}</li>
              ) : (
                medications.map((medication) => (
                  <li key={medication} className="tag-chip tag-chip-emerald">
                    {medication}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
        <div
          className={`patient-field ${canViewNotes ? "col-span-4" : "col-span-12"}`}
        >
          <span className="patient-field-label">{copy.interests}</span>
          <ul className="tag-field-container">
            {(patient.interests ?? []).length === 0 ? (
              <li className="patient-tag-empty">{copy.notSet}</li>
            ) : (
              (patient.interests ?? []).map((interest) => (
                <li key={interest} className="tag-chip tag-chip-amber">
                  {interest}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {(canViewNotes || patient.doNotDisturb) && (
        <div className="patient-grid-layout patient-lifestyle-row">
          {canViewNotes && (
            <div className="patient-field col-span-7">
              <span className="patient-field-label">{copy.otherNotes}</span>
              <p
                data-testid="view-notes"
                className="patient-field-value pre-wrap patient-notes-value"
              >
                {notes || copy.notSet}
              </p>
              {sensitivities && (
                <div className="patient-note-detail">
                  <span className="patient-field-label">
                    {copy.sensitivities}
                  </span>
                  <p className="patient-field-value pre-wrap">
                    {sensitivities}
                  </p>
                </div>
              )}
            </div>
          )}
          <div
            className={`patient-field ${canViewNotes ? "col-span-5" : "col-span-12"}`}
          >
            <span className="patient-field-label">
              {copy.lifestyleAndMedical}
            </span>
            <div className="prototype-toggle-row">
              {canViewNotes && (
                <span
                  className={`patient-toggle-btn ${smoking ? "active" : ""}`}
                >
                  <span>{copy.isSmoker}</span>
                  <span
                    className={`patient-toggle-track ${smoking ? "active" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="patient-toggle-state">
                    {smoking ? copy.yes : copy.no}
                  </span>
                </span>
              )}
              <span
                className={`patient-toggle-btn ${patient.doNotDisturb ? "active" : ""}`}
              >
                <span>{copy.dnd}</span>
                <span
                  className={`patient-toggle-track ${patient.doNotDisturb ? "active" : ""}`}
                  aria-hidden="true"
                />
                <span className="patient-toggle-state">
                  {patient.doNotDisturb ? copy.yes : copy.no}
                </span>
              </span>
              {canViewNotes && (
                <span
                  className={`patient-toggle-btn ${allergiesArray.length > 0 ? "active" : ""}`}
                  data-testid="view-allergy-toggle"
                  aria-label={`${copy.hasAllergy}: ${allergiesArray.length > 0 ? copy.yes : copy.no}`}
                >
                  <span>{copy.hasAllergy}</span>
                  <span
                    className={`patient-toggle-track ${allergiesArray.length > 0 ? "active" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="patient-toggle-state">
                    {allergiesArray.length > 0 ? copy.yes : copy.no}
                  </span>
                </span>
              )}
            </div>
            {smoking && <p className="patient-note-detail">{smoking}</p>}
            {allergiesArray.length > 0 && (
              <ul
                className="patient-profile-allergies"
                aria-label={copy.allergies}
              >
                {allergiesArray.map((allergy, index) => (
                  <li
                    key={`${allergy}-${index}`}
                    className="tag-chip tag-chip-rose"
                  >
                    {patientAllergyLabel(allergy, locale)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <WeightHistorySection
        weights={weights}
        businessTimeZone={businessTimeZone}
        hasMore={weightPage < weightTotalPages}
        loadingMore={weightLoading}
        loadError={weightLoadError}
        onLoadMore={() => void loadMoreWeights()}
      />
      {loading && patient !== null && (
        <p className="patient-profile-status" role="status" aria-live="polite">
          {copy.loading}
        </p>
      )}
    </div>
  );
}
