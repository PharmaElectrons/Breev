import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PatientProfileResponse } from "@breev/contracts/local-rest";
import { useCommittedFocus } from "../committed-focus";
import { useIdentityState } from "../identity-state-provider";
import { directionForLocale } from "../preferences";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";
import { PatientsApiDenied, searchPatients } from "./patient-api";
import { PatientProfileView } from "./patient-profile";
import { PatientForm, ageFromDob } from "./patient-form";
import "./patients.css";

export type PatientsRoute =
  | { readonly patientId: string; readonly kind: "profile" }
  | { readonly kind: "create" }
  | { readonly kind: "index" };

export function patientsRoute(hash: string): PatientsRoute {
  const withoutMarker = hash.startsWith("#") ? hash.slice(1) : hash;
  if (withoutMarker === "/patients/new") {
    return { kind: "create" };
  }
  const match = /^\/patients\/([^/]+)\/?$/u.exec(withoutMarker);
  if (match?.[1] === undefined) return { kind: "index" };
  try {
    return { kind: "profile", patientId: decodeURIComponent(match[1]) };
  } catch {
    return { kind: "index" };
  }
}

export function PatientsPage({ hash }: { readonly hash: string }) {
  const { state: identity } = useIdentityState();
  const authenticated = identity?.state === "authenticated";
  const permissions =
    identity?.state === "authenticated" ? identity.allowedPermissions : [];
  const canViewPatients =
    authenticated && permissions.includes("patients.view");
  const canCreate = authenticated && permissions.includes("patients.manage");
  const canManageNotes = permissions.includes("patients.notes.manage");
  const canManageDiscounts = permissions.includes("patients.discounts.manage");

  const { locale } = usePreferences();
  const copy = patientMessages[locale];
  const route = patientsRoute(hash);

  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<PatientProfileResponse[] | null>(
    null,
  );
  const [totalPatients, setTotalPatients] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchState, setSearchState] = useState<
    "loading" | "success" | "error" | "denied"
  >("loading");
  const [searchFailure, setSearchFailure] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSequenceRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const suppressNextProfileFocusRef = useRef(false);
  const lastRouteKindRef = useRef(route.kind);
  const requestCommittedFocus = useCommittedFocus();

  const executeSearch = useCallback(
    async (searchQuery: string, page = 1) => {
      searchAbortRef.current?.abort();
      const abort = new AbortController();
      searchAbortRef.current = abort;
      const sequence = ++searchSequenceRef.current;
      setSearchState("loading");
      setSearchFailure(null);
      setPatients(null);
      setCurrentPage(page);
      setTotalPatients(0);

      try {
        const result = await searchPatients(
          abort.signal,
          searchQuery,
          page,
          20,
        );
        if (abort.signal.aborted || sequence !== searchSequenceRef.current)
          return;
        setPatients(result.items);
        setTotalPatients(result.total);
        setCurrentPage(result.page);
        setTotalPages(Math.max(1, result.totalPages));
        setSearchState("success");
      } catch (error) {
        if (abort.signal.aborted || sequence !== searchSequenceRef.current)
          return;
        setPatients(null);
        setSearchFailure(
          error instanceof PatientsApiDenied
            ? copy.searchDenied
            : copy.searchUnavailable,
        );
        setSearchState(error instanceof PatientsApiDenied ? "denied" : "error");
      } finally {
        if (sequence === searchSequenceRef.current) {
          searchAbortRef.current = null;
        }
      }
    },
    [copy.searchDenied, copy.searchUnavailable],
  );

  useEffect(() => {
    if (!canViewPatients) return;
    const timer = window.setTimeout(() => {
      void executeSearch(query, 1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [canViewPatients, executeSearch, query]);

  useEffect(
    () => () => {
      searchSequenceRef.current += 1;
      searchAbortRef.current?.abort();
    },
    [],
  );

  useLayoutEffect(() => {
    const previousKind = lastRouteKindRef.current;
    lastRouteKindRef.current = route.kind;
    if (route.kind === "create") {
      requestCommittedFocus(() => document.getElementById("first-name-input"));
    } else if (previousKind === "create") {
      requestCommittedFocus(() =>
        route.kind === "index"
          ? (createButtonRef.current ?? searchInputRef.current)
          : searchInputRef.current,
      );
    }
  }, [requestCommittedFocus, route.kind]);

  const handleCreate = () => {
    suppressNextProfileFocusRef.current = false;
    window.location.hash = "#/patients/new";
  };

  const handleSelectPatient = (id: string) => {
    suppressNextProfileFocusRef.current = false;
    window.location.hash = `#/patients/${encodeURIComponent(id)}`;
  };

  const handleRetrySearch = () => {
    void executeSearch(query, currentPage);
  };

  if (!canViewPatients) {
    return (
      <section
        className="patients-screen"
        aria-labelledby="patients-title"
        dir={directionForLocale(locale)}
      >
        <div className="patients-denied-panel">
          <h2 id="patients-title">{copy.title}</h2>
          <p className="denial-alert" role="status" aria-live="polite">
            {copy.permissionDenied}
          </p>
        </div>
      </section>
    );
  }

  const selectedId = route.kind === "profile" ? route.patientId : null;

  return (
    <section
      className="patients-screen"
      aria-labelledby="patients-title"
      dir={directionForLocale(locale)}
    >
      <aside className="patients-sidebar" aria-label={copy.title}>
        <div className="patients-sidebar-header">
          <div className="patients-sidebar-title-row">
            <h2 id="patients-title">{copy.title}</h2>
            {canCreate && (
              <button
                ref={createButtonRef}
                type="button"
                onClick={handleCreate}
                data-testid="create-patient-button"
                className="patient-create-btn"
              >
                + {copy.createPatient}
              </button>
            )}
          </div>

          <div className="patients-search-box">
            <input
              ref={searchInputRef}
              type="search"
              aria-label={copy.searchLabel}
              placeholder={copy.searchPlaceholder}
              value={query}
              onChange={(event) => {
                searchAbortRef.current?.abort();
                searchSequenceRef.current += 1;
                setSearchState("loading");
                setSearchFailure(null);
                setPatients(null);
                setTotalPatients(0);
                setCurrentPage(1);
                setQuery(event.target.value);
              }}
              aria-busy={searchState === "loading"}
              className="patients-search-input"
              data-testid="patient-search-input"
            />
          </div>
        </div>

        <div className="patients-list-region">
          {searchState === "loading" && (
            <p
              className="patients-list-status"
              role="status"
              aria-live="polite"
            >
              {copy.loading}
            </p>
          )}
          {(searchState === "error" || searchState === "denied") && (
            <div className="patients-list-error" role="alert">
              <p>{searchFailure}</p>
              {searchState === "error" && (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={handleRetrySearch}
                >
                  {copy.retryAction}
                </button>
              )}
            </div>
          )}
          {searchState === "success" && patients?.length === 0 && (
            <p
              className="patients-list-status"
              role="status"
              aria-live="polite"
            >
              {query.trim() ? copy.emptyResults : copy.emptyList}
            </p>
          )}
          {searchState === "success" &&
            patients !== null &&
            patients.length > 0 && (
              <ul className="patients-list" aria-label={copy.searchResults}>
                {patients.map((patient) => {
                  const isSelected = patient.id === selectedId;
                  const name =
                    `${patient.firstName} ${patient.lastName}`.trim();
                  return (
                    <li key={patient.id}>
                      <button
                        type="button"
                        aria-current={isSelected ? "page" : undefined}
                        aria-label={`${name}, ${patient.phone ?? copy.notSet}`}
                        data-testid={`patient-row-${patient.id}`}
                        onClick={() => handleSelectPatient(patient.id)}
                        className={`patient-list-item ${isSelected ? "selected" : ""}`}
                      >
                        <span className="patient-list-name">{name}</span>
                        <span className="patient-list-phone">
                          {patient.phone ?? copy.notSet}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
        </div>

        {searchState === "success" && totalPages > 1 && (
          <div className="pagination-bar" aria-label={copy.searchPagination}>
            <span>
              {copy.page} {currentPage} {copy.of} {totalPages}
            </span>
            <div className="pagination-actions">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => void executeSearch(query, currentPage - 1)}
                className="btn-outline"
              >
                {copy.previous}
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => void executeSearch(query, currentPage + 1)}
                className="btn-outline"
              >
                {copy.next}
              </button>
            </div>
          </div>
        )}
      </aside>

      <div className="patient-main-content">
        {route.kind === "create" ? (
          <PatientForm
            patient={null}
            onSaved={(createdPatient) => {
              suppressNextProfileFocusRef.current = true;
              window.location.hash = `#/patients/${encodeURIComponent(createdPatient.id)}`;
            }}
            onCancel={() => {
              window.location.hash = "#/patients";
            }}
            canManageNotes={canManageNotes}
            canManageDiscounts={canManageDiscounts}
          />
        ) : route.kind === "profile" ? (
          <PatientProfileView
            patientId={route.patientId}
            focusOnLoad={!suppressNextProfileFocusRef.current}
            onProfileUpdated={() => void executeSearch(query, currentPage)}
          />
        ) : (
          <div className="patient-directory-card">
            <div className="patient-directory-header">
              <h3 className="patient-directory-title">
                {copy.patientDirectory}
              </h3>
              <span className="patient-directory-total" role="status">
                {totalPatients} {copy.title}
              </span>
            </div>

            {searchState === "success" &&
              patients !== null &&
              patients.length > 0 && (
                <table className="patient-directory-table">
                  <caption>{copy.patientDirectory}</caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">{copy.fullName}</th>
                      <th scope="col">{copy.phone}</th>
                      <th scope="col">{copy.address}</th>
                      <th scope="col">{copy.age}</th>
                      <th scope="col">{copy.chronicConditions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patients.map((patient, index) => {
                      const age = ageFromDob(patient.dateOfBirth);
                      return (
                        <tr key={patient.id}>
                          <td className="patient-directory-index">
                            {(currentPage - 1) * 20 + index + 1}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="patient-directory-open"
                              onClick={() => handleSelectPatient(patient.id)}
                            >
                              {patient.firstName} {patient.lastName}
                            </button>
                          </td>
                          <td className="patient-directory-phone">
                            {patient.phone ?? copy.notSet}
                          </td>
                          <td>{patient.address ?? copy.notSet}</td>
                          <td className="patient-directory-age">
                            {age !== null
                              ? `${age} ${copy.years}`
                              : copy.notSet}
                          </td>
                          <td>
                            {patient.chronicConditions
                              ?.slice(0, 3)
                              .join("، ") || copy.notSet}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
          </div>
        )}
      </div>
    </section>
  );
}
