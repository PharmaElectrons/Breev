import { useState, useEffect, useCallback } from "react";
import type { PatientProfileBase } from "@breev/contracts/local-rest";
import { useIdentityState } from "../identity-state-provider";
import { usePreferences } from "../preferences-provider";
import { patientMessages } from "./patient-messages";
import { searchPatients } from "./patient-api";
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
  return match?.[1] === undefined
    ? { kind: "index" }
    : { patientId: match[1], kind: "profile" };
}

export function PatientsPage({ hash }: { readonly hash: string }) {
  const { state: identity } = useIdentityState();
  const authenticated = identity?.state === "authenticated";
  const canViewPatients =
    authenticated && identity.allowedPermissions.includes("patients.view");
  const canCreate =
    authenticated && identity.allowedPermissions.includes("patients.manage");
  const canManageNotes =
    authenticated &&
    identity.allowedPermissions.includes("patients.notes.manage");
  const canManageDiscounts =
    authenticated &&
    identity.allowedPermissions.includes("patients.discounts.manage");

  const { locale } = usePreferences();
  const copy = patientMessages[locale];

  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<PatientProfileBase[] | null>(null);
  const [totalPatients, setTotalPatients] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [busy, setBusy] = useState(false);

  const route = patientsRoute(hash);

  const executeSearch = useCallback(
    async (searchQuery: string, page: number = 1) => {
      setBusy(true);
      try {
        const abort = new AbortController();
        const res = await searchPatients(abort.signal, searchQuery, page, 20);
        setPatients(res.items);
        setTotalPatients(res.total);
        setCurrentPage(res.page);
        setTotalPages(res.totalPages || 1);
      } catch (e) {
        console.error(e);
        setPatients([]);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void executeSearch(query, 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, executeSearch]);

  const handleCreate = () => {
    window.location.hash = "#/patients/new";
  };

  const handleSelectPatient = (id: string) => {
    window.location.hash = `#/patients/${id}`;
  };

  if (!canViewPatients) {
    return (
      <section className="patients-screen" aria-labelledby="patients-title">
        <div style={{ padding: "1.5rem" }}>
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
    <section className="patients-screen" aria-labelledby="patients-title">
      {/* Sidebar: Patient Search & Directory list */}
      <aside className="patients-sidebar" aria-label={copy.title}>
        <div className="patients-sidebar-header">
          <div className="patients-sidebar-title-row">
            <h2 id="patients-title">{copy.title}</h2>
            {canCreate && (
              <button
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
              type="search"
              role="searchbox"
              aria-label={copy.searchLabel}
              placeholder={copy.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-busy={busy}
              className="patients-search-input"
              data-testid="patient-search-input"
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {patients === null ? (
            <div
              aria-live="polite"
              style={{
                padding: "1rem",
                color: "var(--muted-foreground)",
                fontSize: "0.8125rem",
              }}
            >
              {copy.loading}
            </div>
          ) : patients.length === 0 ? (
            <div
              aria-live="polite"
              style={{
                padding: "1rem",
                color: "var(--muted-foreground)",
                fontSize: "0.8125rem",
              }}
            >
              {query ? copy.emptyResults : copy.emptyList}
            </div>
          ) : (
            <ul
              role="listbox"
              aria-label={copy.title}
              className="patients-list"
            >
              {patients.map((p) => {
                const isSelected = p.id === selectedId;
                return (
                  <li
                    key={p.id}
                    role="option"
                    aria-selected={isSelected}
                    data-testid={`patient-row-${p.id}`}
                    onClick={() => handleSelectPatient(p.id)}
                    className={`patient-list-item ${isSelected ? "selected" : ""}`}
                  >
                    <div className="patient-list-name">
                      {p.firstName} {p.lastName}
                    </div>
                    <div className="patient-list-phone">{p.phone ?? "—"}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Pagination in sidebar */}
        {totalPages > 1 && (
          <div className="pagination-bar">
            <span>
              {copy.page} {currentPage} {copy.of} {totalPages}
            </span>
            <div className="pagination-actions">
              <button
                type="button"
                disabled={currentPage <= 1 || busy}
                onClick={() => executeSearch(query, currentPage - 1)}
                className="btn-outline"
                style={{ padding: "0.2rem 0.5rem" }}
              >
                {copy.previous}
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages || busy}
                onClick={() => executeSearch(query, currentPage + 1)}
                className="btn-outline"
                style={{ padding: "0.2rem 0.5rem" }}
              >
                {copy.next}
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="patient-main-content">
        {route.kind === "create" ? (
          <PatientForm
            patient={null}
            onSaved={(createdPatient) => {
              window.location.hash = `#/patients/${createdPatient.id}`;
              void executeSearch(query, currentPage);
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
            onProfileUpdated={() => executeSearch(query, currentPage)}
          />
        ) : (
          /* Prototype Patient Directory Table when on Index View */
          <div className="patient-directory-card">
            <div className="patient-directory-header">
              <h3 className="patient-directory-title">
                {copy.patientDirectory}
              </h3>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-family-mono)",
                  color: "var(--muted-foreground)",
                }}
              >
                {totalPatients} {copy.title}
              </span>
            </div>

            {patients === null ? (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  color: "var(--muted-foreground)",
                }}
              >
                {copy.loading}
              </div>
            ) : patients.length === 0 ? (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  color: "var(--muted-foreground)",
                  fontSize: "0.875rem",
                }}
              >
                {copy.emptyList}
              </div>
            ) : (
              <table className="patient-directory-table">
                <caption
                  style={{
                    textAlign: "start",
                    padding: "0.25rem 0",
                    color: "var(--muted-foreground)",
                    fontSize: "0.6875rem",
                  }}
                >
                  {copy.patientDirectory}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: "3rem" }}>
                      #
                    </th>
                    <th scope="col">{copy.fullName}</th>
                    <th scope="col">{copy.phone}</th>
                    <th scope="col">{copy.address}</th>
                    <th scope="col">{copy.age}</th>
                    <th scope="col">{copy.chronicConditions}</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((p, idx) => {
                    const age = ageFromDob(p.dateOfBirth);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => handleSelectPatient(p.id)}
                        className={p.id === selectedId ? "selected" : ""}
                      >
                        <td
                          style={{
                            fontFamily: "var(--font-family-mono)",
                            color: "var(--muted-foreground)",
                          }}
                        >
                          {(currentPage - 1) * 20 + idx + 1}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectPatient(p.id);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--primary)",
                              fontWeight: 700,
                              cursor: "pointer",
                              padding: 0,
                              fontSize: "inherit",
                              textAlign: "inherit",
                            }}
                          >
                            {p.firstName} {p.lastName}
                          </button>
                        </td>
                        <td style={{ fontFamily: "var(--font-family-mono)" }}>
                          {p.phone ?? copy.notSet}
                        </td>
                        <td>{p.address ?? copy.notSet}</td>
                        <td style={{ fontFamily: "var(--font-family-mono)" }}>
                          {age !== null ? `${age} ${copy.years}` : copy.notSet}
                        </td>
                        <td>
                          {(p.chronicConditions ?? []).slice(0, 3).join("، ") ||
                            copy.notSet}
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
