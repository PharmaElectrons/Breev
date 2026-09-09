import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PurchaseDraft, Supplier } from "@breev/contracts/local-rest";
import { usePreferences } from "./preferences-provider";
import {
  archiveSupplier,
  createSupplier,
  editSupplier,
  mergeSupplier,
  PurchasingApiDenied,
  purchasingCommandAttempt,
  type PurchasingCommandAttempt,
} from "./purchasing-api";
import { IdentityApiDenied } from "./identity-api";
import { purchasingMessages } from "./purchasing-messages";

interface SupplierExtraDetails {
  phone: string;
  address: string;
  paymentTerms: "credit" | "cash";
  creditLimit: number;
  duePeriodDays: number;
  alertWindowDays: number;
  notes?: string;
}

function parseTerms(terms: string | null): SupplierExtraDetails {
  const fallback: SupplierExtraDetails = {
    phone: "",
    address: "",
    paymentTerms: "credit",
    creditLimit: 0,
    duePeriodDays: 30,
    alertWindowDays: 7,
  };
  if (!terms) return fallback;
  try {
    const parsed = JSON.parse(terms);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        phone: typeof parsed.phone === "string" ? parsed.phone : "",
        address: typeof parsed.address === "string" ? parsed.address : "",
        paymentTerms: parsed.paymentTerms === "cash" ? "cash" : "credit",
        creditLimit: Number(parsed.creditLimit) || 0,
        duePeriodDays: Number(parsed.duePeriodDays) || 30,
        alertWindowDays: Number(parsed.alertWindowDays) || 7,
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
      };
    }
  } catch {
    return {
      ...fallback,
      notes: terms,
    };
  }
  return fallback;
}

function serializeTerms(details: SupplierExtraDetails): string {
  return JSON.stringify(details);
}

const today = (): string => {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

export function SuppliersWorkspace({
  baseUrl,
  suppliers,
  drafts,
  onChanged,
}: {
  readonly baseUrl: string;
  readonly suppliers: readonly Supplier[];
  readonly drafts: readonly PurchaseDraft[];
  readonly onChanged: () => Promise<void>;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const isAr = locale === "ar";
  const nameId = useId();
  const phoneId = useId();
  const addressId = useId();
  const paymentTermsId = useId();
  const discountId = useId();
  const creditLimitId = useId();
  const duePeriodId = useId();
  const alertWindowId = useId();
  const mergeId = useId();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<"credit" | "cash">("credit");
  const [discountPct, setDiscountPct] = useState(0);
  const [creditLimit, setCreditLimit] = useState(0);
  const [duePeriodDays, setDuePeriodDays] = useState(30);
  const [alertWindowDays, setAlertWindowDays] = useState(7);
  const [survivorId, setSurvivorId] = useState("");
  const [statementOpen, setStatementOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const supplierCommandAttempt = useRef<PurchasingCommandAttempt | null>(null);

  const selected = useMemo(
    () => suppliers.find((s) => s.id === selectedId) ?? null,
    [suppliers, selectedId],
  );

  useEffect(() => {
    if (selected) {
      const details = parseTerms(selected.terms);
      setName(selected.name);
      setPhone(details.phone);
      setAddress(details.address);
      setPaymentTerms(details.paymentTerms);
      setDiscountPct(Number(selected.defaultAllowancePercentage) || 0);
      setCreditLimit(details.creditLimit);
      setDuePeriodDays(details.duePeriodDays);
      setAlertWindowDays(details.alertWindowDays);
      setSurvivorId("");
    } else {
      setName("");
      setPhone("");
      setAddress("");
      setPaymentTerms("credit");
      setDiscountPct(0);
      setCreditLimit(0);
      setDuePeriodDays(30);
      setAlertWindowDays(7);
      setSurvivorId("");
    }
  }, [selected]);

  const supplierDrafts = useMemo(
    () => drafts.filter((d) => d.supplierId === selectedId),
    [drafts, selectedId],
  );

  const balanceFor = (id: string): number => {
    return drafts
      .filter((d) => d.supplierId === id)
      .reduce((sum, d) => {
        const basis = Number(d.allowanceSnapshot.basisFils) / 1000;
        return sum + (d.settlementContext === "debt" ? basis : 0);
      }, 0);
  };

  const liveBalance = selected ? balanceFor(selected.id) : 0;
  const overLimit = selected && creditLimit > 0 && liveBalance > creditLimit;

  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => {
      const details = parseTerms(s.terms);
      return (
        s.name.toLowerCase().includes(q) ||
        details.phone.toLowerCase().includes(q) ||
        details.address.toLowerCase().includes(q)
      );
    });
  }, [suppliers, query]);

  const adjustDiscount = (delta: number) => {
    setDiscountPct((prev) => {
      const next = Math.min(100, Math.max(0, prev + delta));
      return Number(next.toFixed(2));
    });
  };

  const supplierSaveFailure = (cause: unknown): string => {
    if (cause instanceof IdentityApiDenied) {
      if (cause.denial.code === "permission-denied")
        return copy.supplierSavePermissionDenied;
      if (
        cause.denial.code === "session-expired" ||
        cause.denial.code === "session-missing" ||
        cause.denial.code === "session-revoked"
      )
        return copy.supplierSaveSessionEnded;
    }
    if (cause instanceof PurchasingApiDenied) {
      if (cause.denial.code === "body-invalid") return copy.supplierSaveInvalid;
      if (
        cause.denial.code === "allowance-rate-date-conflict" ||
        cause.denial.code === "idempotency-conflict" ||
        cause.denial.code === "supplier-archived" ||
        cause.denial.code === "supplier-merged" ||
        cause.denial.code === "supplier-not-found" ||
        cause.denial.code === "version-conflict"
      )
        return copy.supplierSaveConflict;
    }
    return copy.supplierSaveUnavailable;
  };

  const refreshAfterSupplierChange = async (): Promise<boolean> => {
    try {
      await onChanged();
      return true;
    } catch {
      setMessage(copy.supplierSavedRefreshFailed);
      return false;
    }
  };

  const chooseNew = () => {
    supplierCommandAttempt.current = null;
    setSelectedId(null);
    setName(isAr ? "مذخر جديد" : "New supplier");
    setPhone("");
    setAddress("");
    setPaymentTerms("credit");
    setDiscountPct(0);
    setCreditLimit(0);
    setDuePeriodDays(30);
    setAlertWindowDays(7);
    setSurvivorId("");
    setMessage(null);
  };

  const chooseSupplier = (id: string) => {
    supplierCommandAttempt.current = null;
    setMessage(null);
    setSelectedId(id);
  };

  const save = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage(null);
    const details: SupplierExtraDetails = {
      phone: phone.trim(),
      address: address.trim(),
      paymentTerms,
      creditLimit: Math.max(0, Number(creditLimit) || 0),
      duePeriodDays: Math.max(1, Number(duePeriodDays) || 30),
      alertWindowDays: Math.max(0, Number(alertWindowDays) || 7),
    };
    const serialized = serializeTerms(details);
    const allowancePctString = String(
      Math.min(100, Math.max(0, Number(discountPct) || 0)),
    );
    const fields = {
      allowanceEffectiveFrom: selected?.allowanceEffectiveFrom ?? today(),
      defaultAllowancePercentage: allowancePctString,
      name: name.trim(),
      terms: serialized,
    };

    try {
      const attempt = purchasingCommandAttempt(
        supplierCommandAttempt.current,
        JSON.stringify({
          action: selected === null ? "create" : "edit",
          fields,
          supplierId: selected?.id,
          expectedRevision: selected?.revision,
        }),
      );
      supplierCommandAttempt.current = attempt;
      const saved =
        selected === null
          ? await createSupplier(baseUrl, {
              ...fields,
              idempotencyKey: attempt.idempotencyKey,
            })
          : await editSupplier(baseUrl, selected.id, {
              ...fields,
              expectedRevision: selected.revision,
              idempotencyKey: attempt.idempotencyKey,
            });
      setSelectedId(saved.id);
      setMessage(copy.supplierSaved);
      if (await refreshAfterSupplierChange())
        supplierCommandAttempt.current = null;
    } catch (cause) {
      setMessage(supplierSaveFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!selected) return;
    if (!window.confirm(copy.archiveSupplier)) return;
    setBusy(true);
    try {
      const attempt = purchasingCommandAttempt(
        supplierCommandAttempt.current,
        JSON.stringify({
          action: "archive",
          supplierId: selected.id,
          expectedRevision: selected.revision,
        }),
      );
      supplierCommandAttempt.current = attempt;
      await archiveSupplier(baseUrl, selected.id, {
        expectedRevision: selected.revision,
        idempotencyKey: attempt.idempotencyKey,
      });
      setSelectedId(null);
      setMessage(copy.supplierSaved);
      if (await refreshAfterSupplierChange())
        supplierCommandAttempt.current = null;
    } catch (cause) {
      setMessage(supplierSaveFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    if (!selected || !survivorId) return;
    setBusy(true);
    try {
      const attempt = purchasingCommandAttempt(
        supplierCommandAttempt.current,
        JSON.stringify({
          action: "merge",
          supplierId: selected.id,
          expectedRevision: selected.revision,
          survivorSupplierId: survivorId,
        }),
      );
      supplierCommandAttempt.current = attempt;
      await mergeSupplier(baseUrl, selected.id, {
        expectedRevision: selected.revision,
        idempotencyKey: attempt.idempotencyKey,
        survivorSupplierId: survivorId,
      });
      setSelectedId(null);
      setMessage(copy.supplierSaved);
      if (await refreshAfterSupplierChange())
        supplierCommandAttempt.current = null;
    } catch (cause) {
      setMessage(supplierSaveFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  const formatIQD = (amount: number): string => {
    return `${Math.round(amount).toLocaleString("en-US")} ${copy.iqd}`;
  };

  const activeSuppliers = suppliers.filter((s) => s.status === "active");

  return (
    <section
      className="supplier-manager flex-1 flex overflow-hidden"
      aria-labelledby="supplier-section-title"
      dir={isAr ? "rtl" : "ltr"}
    >
      <h2 id="supplier-section-title" className="visually-hidden">
        {copy.suppliers}
      </h2>
      {/* Search and Supplier List Sidebar */}
      <aside className="supplier-sidebar w-72 shrink-0 border-inline-end border-border flex flex-col bg-card/60">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={copy.searchSupplierPlaceholder}
              className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary"
              aria-label={copy.searchSupplierPlaceholder}
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {filteredSuppliers.map((s) => {
            const bal = balanceFor(s.id);
            const isSel = s.id === selectedId;
            const details = parseTerms(s.terms);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={isSel}
                onClick={() => chooseSupplier(s.id)}
                className={`supplier-tile w-full text-start px-3 py-2 border-b border-border/50 transition hover:bg-primary/10 ${
                  isSel
                    ? "bg-primary/15 border-inline-start-4 border-inline-start-primary"
                    : ""
                }`}
              >
                <div className="text-sm font-bold text-foreground truncate">
                  {s.name}
                </div>
                <div className="flex items-center justify-between text-[11px] mt-0.5">
                  <span className="text-muted-foreground font-mono">
                    {details.phone || "—"}
                  </span>
                  <span
                    className={`font-mono font-bold ${
                      bal > 0 ? "text-danger" : "text-ready"
                    }`}
                  >
                    {formatIQD(bal)}
                  </span>
                </div>
              </button>
            );
          })}
          {filteredSuppliers.length === 0 && (
            <p className="p-6 text-center text-xs text-muted-foreground">
              {copy.noSuppliersFound}
            </p>
          )}
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        {/* Action Toolbar */}
        <div className="supplier-toolbar p-3 border-b border-border flex items-center justify-between gap-3 shrink-0 bg-card/70">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={chooseNew}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition bg-primary/15 border-primary/40 text-primary hover:bg-primary/25"
              title={copy.newSupplier}
            >
              <span aria-hidden="true">＋</span>
              <span>{copy.add}</span>
            </button>
            <button
              type="button"
              onClick={() => void archive()}
              disabled={!selectedId || busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition bg-danger/15 border-danger/40 text-danger hover:bg-danger/25 disabled:opacity-40"
              title={copy.archiveSupplier}
            >
              <span aria-hidden="true">🗑</span>
              <span>{copy.delete}</span>
            </button>
            <button
              type="button"
              onClick={() => setStatementOpen(true)}
              disabled={!selected}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition bg-muted border-control-border text-foreground hover:bg-muted/80 disabled:opacity-40"
              title={copy.statement}
            >
              <span aria-hidden="true">📄</span>
              <span>{copy.statement}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !name.trim()}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition"
          >
            {busy ? (
              "..."
            ) : (
              <>
                <span aria-hidden="true">💾</span>
                <span>{copy.save}</span>
              </>
            )}
          </button>
        </div>

        {/* Status / Alert Banner */}
        {overLimit && (
          <div className="px-4 py-2 border-b border-border bg-danger/15 text-danger font-bold text-xs flex items-center gap-2">
            <span aria-hidden="true">⚠️</span>
            <span>
              {copy.limitExceeded} {formatIQD(liveBalance)} /{" "}
              {formatIQD(creditLimit)}
            </span>
          </div>
        )}
        {message && (
          <div
            role="status"
            className="px-4 py-2 border-b border-border text-xs font-bold bg-primary/10 text-primary"
          >
            {message}
          </div>
        )}

        {/* 3-Card Layout */}
        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Card 1: Supplier Profile (2 cols) */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4 space-y-3 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">
              {copy.supplierProfile}
            </h3>
            <form onSubmit={(e) => void save(e)} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label htmlFor={nameId} className="block">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    {copy.supplierName}
                  </span>
                  <input
                    id={nameId}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <label htmlFor={phoneId} className="block">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    {copy.phone}
                  </span>
                  <input
                    id={phoneId}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <label htmlFor={addressId} className="block">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    {copy.location}
                  </span>
                  <input
                    id={addressId}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <label htmlFor={paymentTermsId} className="block">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    {copy.defaultPayment}
                  </span>
                  <select
                    id={paymentTermsId}
                    value={paymentTerms}
                    onChange={(e) =>
                      setPaymentTerms(e.target.value as "credit" | "cash")
                    }
                    className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="credit">{copy.creditTerm}</option>
                    <option value="cash">{copy.cashTerm}</option>
                  </select>
                </label>
                <div className="block">
                  <label
                    htmlFor={discountId}
                    className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1"
                  >
                    {copy.allowance}
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustDiscount(-0.5)}
                      className="size-8 grid place-items-center bg-muted border border-control-border rounded-lg hover:bg-danger/20 hover:text-danger text-sm font-bold"
                      aria-label="Decrease discount by 0.5 percent"
                    >
                      －
                    </button>
                    <input
                      id={discountId}
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={discountPct}
                      onChange={(e) =>
                        setDiscountPct(Number(e.target.value) || 0)
                      }
                      className="flex-1 min-w-0 bg-muted border border-control-border rounded-lg px-3 py-2 text-sm text-center font-mono outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={() => adjustDiscount(0.5)}
                      className="size-8 grid place-items-center bg-muted border border-control-border rounded-lg hover:bg-ready/20 hover:text-ready text-sm font-bold"
                      aria-label="Increase discount by 0.5 percent"
                    >
                      ＋
                    </button>
                  </div>
                </div>
                <label htmlFor={creditLimitId} className="block">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    {copy.creditLimit}
                  </span>
                  <input
                    id={creditLimitId}
                    type="number"
                    min={0}
                    value={creditLimit}
                    onChange={(e) =>
                      setCreditLimit(Number(e.target.value) || 0)
                    }
                    className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <label htmlFor={duePeriodId} className="block">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    {copy.duePeriod}
                  </span>
                  <input
                    id={duePeriodId}
                    type="number"
                    min={1}
                    value={duePeriodDays}
                    onChange={(e) =>
                      setDuePeriodDays(Number(e.target.value) || 30)
                    }
                    className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <label htmlFor={alertWindowId} className="block">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    {copy.alertWindow}
                  </span>
                  <input
                    id={alertWindowId}
                    type="number"
                    min={0}
                    value={alertWindowDays}
                    onChange={(e) =>
                      setAlertWindowDays(Number(e.target.value) || 0)
                    }
                    className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
              </div>
            </form>
            {selected?.status === "active" && activeSuppliers.length > 1 && (
              <div className="pt-3 border-t border-border flex items-center gap-2">
                <label htmlFor={mergeId} className="flex-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    {copy.mergeInto}
                  </span>
                  <select
                    id={mergeId}
                    value={survivorId}
                    onChange={(e) => setSurvivorId(e.target.value)}
                    className="w-full bg-muted border border-control-border rounded-lg px-2 py-1 text-xs outline-none"
                  >
                    <option value="">{copy.select}</option>
                    {activeSuppliers
                      .filter((s) => s.id !== selected.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!survivorId || busy}
                  onClick={() => void merge()}
                  className="mt-4 px-3 py-1.5 rounded-lg border border-control-border text-xs font-bold hover:bg-muted disabled:opacity-40"
                >
                  {copy.mergeSupplier}
                </button>
              </div>
            )}
          </div>

          {/* Card 2: Live Balance (1 col) */}
          <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between shadow-xs">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">
                {copy.supplierBalance}
              </h3>
              <p
                className={`text-4xl font-mono font-bold tabular-nums mt-4 ${
                  liveBalance > 0 ? "text-danger" : "text-ready"
                }`}
              >
                {formatIQD(liveBalance)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {copy.balanceSubtitle}
              </p>
            </div>
            {selected && creditLimit > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>{copy.creditLimit}</span>
                  <span className="font-mono">{formatIQD(creditLimit)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      overLimit ? "bg-danger" : "bg-ready"
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        (liveBalance / Math.max(1, creditLimit)) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Transaction Ledger (3 cols) */}
          <div className="lg:col-span-3 bg-card border border-border rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                {copy.invoiceLedger}
              </h3>
              <span className="text-xs text-muted-foreground font-mono">
                {supplierDrafts.length} {copy.invoicesCount}
              </span>
            </div>
            <div className="overflow-auto max-h-[36vh] border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase text-muted-foreground bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-start">#</th>
                    <th className="px-3 py-2 text-start">{copy.date}</th>
                    <th className="px-3 py-2 text-start">{copy.payment}</th>
                    <th className="px-3 py-2 text-start">{copy.status}</th>
                    <th className="px-3 py-2 text-end">{copy.total}</th>
                    <th className="px-3 py-2 text-end">{copy.paid}</th>
                    <th className="px-3 py-2 text-end">{copy.outstanding}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {supplierDrafts.map((d, index) => {
                    const totalIQD =
                      Number(d.allowanceSnapshot.basisFils) / 1000;
                    const paidIQD =
                      d.settlementContext === "cash" ? totalIQD : 0;
                    const outstanding = totalIQD - paidIQD;
                    return (
                      <tr key={d.id} className="hover:bg-muted/50">
                        <td className="px-3 py-2 font-mono">
                          {d.supplierInvoiceNumber || index + 1}
                        </td>
                        <td className="px-3 py-2 font-mono">{d.invoiceDate}</td>
                        <td className="px-3 py-2">
                          {d.settlementContext === "cash"
                            ? copy.cash
                            : copy.debt}
                        </td>
                        <td className="px-3 py-2">{copy[d.status]}</td>
                        <td className="px-3 py-2 font-mono text-end">
                          {formatIQD(totalIQD)}
                        </td>
                        <td className="px-3 py-2 font-mono text-end text-ready">
                          {formatIQD(paidIQD)}
                        </td>
                        <td
                          className={`px-3 py-2 font-mono text-end font-bold ${
                            outstanding > 0 ? "text-danger" : "text-ready"
                          }`}
                        >
                          {formatIQD(outstanding)}
                        </td>
                      </tr>
                    );
                  })}
                  {supplierDrafts.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="p-6 text-center text-muted-foreground"
                      >
                        {copy.noTransactions}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Statement Dialog */}
        {statementOpen && selected && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs grid place-items-center p-4"
            onClick={() => setStatementOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="statement-dialog-title"
              className="bg-card border border-control-border rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              dir={isAr ? "rtl" : "ltr"}
            >
              <header className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-primary font-bold uppercase tracking-wider">
                    {copy.statement}
                  </p>
                  <h2
                    id="statement-dialog-title"
                    className="text-lg font-bold text-foreground"
                  >
                    {selected.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setStatementOpen(false)}
                  className="px-4 py-2 bg-muted border border-control-border rounded-lg text-xs font-bold hover:bg-muted/80"
                >
                  {copy.closeStatement}
                </button>
              </header>
              <div className="flex-1 overflow-auto p-4 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-muted border border-border rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                      {copy.totalPurchases}
                    </p>
                    <p className="font-mono font-bold text-base text-foreground">
                      {formatIQD(
                        supplierDrafts.reduce(
                          (sum, d) =>
                            sum + Number(d.allowanceSnapshot.basisFils) / 1000,
                          0,
                        ),
                      )}
                    </p>
                  </div>
                  <div className="bg-muted border border-border rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                      {copy.paid}
                    </p>
                    <p className="font-mono font-bold text-base text-ready">
                      {formatIQD(
                        supplierDrafts.reduce(
                          (sum, d) =>
                            sum +
                            (d.settlementContext === "cash"
                              ? Number(d.allowanceSnapshot.basisFils) / 1000
                              : 0),
                          0,
                        ),
                      )}
                    </p>
                  </div>
                  <div className="bg-muted border border-border rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                      {copy.outstandingBalance}
                    </p>
                    <p
                      className={`font-mono font-bold text-base ${
                        liveBalance > 0 ? "text-danger" : "text-ready"
                      }`}
                    >
                      {formatIQD(liveBalance)}
                    </p>
                  </div>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase text-muted-foreground bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-start">{copy.date}</th>
                        <th className="px-3 py-2 text-start">#</th>
                        <th className="px-3 py-2 text-end">{copy.debit}</th>
                        <th className="px-3 py-2 text-end">{copy.credit}</th>
                        <th className="px-3 py-2 text-end">{copy.balance}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {(() => {
                        let running = 0;
                        return supplierDrafts.map((d, i) => {
                          const total =
                            Number(d.allowanceSnapshot.basisFils) / 1000;
                          const paid =
                            d.settlementContext === "cash" ? total : 0;
                          running += total - paid;
                          return (
                            <tr key={d.id} className="hover:bg-muted/30">
                              <td className="px-3 py-2 font-mono">
                                {d.invoiceDate}
                              </td>
                              <td className="px-3 py-2 font-mono">
                                {d.supplierInvoiceNumber || i + 1}
                              </td>
                              <td className="px-3 py-2 font-mono text-end text-danger">
                                {formatIQD(total)}
                              </td>
                              <td className="px-3 py-2 font-mono text-end text-ready">
                                {formatIQD(paid)}
                              </td>
                              <td className="px-3 py-2 font-mono text-end font-bold">
                                {formatIQD(running)}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
