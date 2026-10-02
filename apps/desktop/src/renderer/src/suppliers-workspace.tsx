import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Supplier } from "@breev/contracts/local-rest";
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
import { purchasingMessages } from "./purchasing-messages";

type PurchasingCopy =
  (typeof purchasingMessages)[keyof typeof purchasingMessages];

function getSupplierErrorMessage(err: unknown, copy: PurchasingCopy): string {
  if (err instanceof PurchasingApiDenied) {
    if (err.denial.code === "supplier-archived")
      return copy.supplierArchivedError;
    if (err.denial.code === "supplier-merged") return copy.supplierMergedError;
    if (err.denial.code === "version-conflict")
      return copy.supplierVersionConflictError;
  }
  return copy.error;
}

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
  initialSelectedId,
  onChanged,
}: {
  readonly baseUrl: string;
  readonly suppliers: readonly Supplier[];
  readonly initialSelectedId?: string;
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
  const duePeriodId = useId();
  const mergeId = useId();

  const [selectedId, setSelectedId] = useState<string | null>(
    () => initialSelectedId ?? suppliers[0]?.id ?? null,
  );
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
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);

  const supplierCommandAttempt = useRef<PurchasingCommandAttempt | null>(null);

  const selected = useMemo(
    () => suppliers.find((s) => s.id === selectedId) ?? null,
    [suppliers, selectedId],
  );

  const isInactive = selected !== null && selected.status !== "active";
  const isArchived = selected?.status === "archived";

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
      setMessage(null);
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
      setMessage(null);
    }
    supplierCommandAttempt.current = null;
  }, [selected]);

  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (!showArchived && !q && s.status !== "active" && s.id !== selectedId) {
        return false;
      }
      if (!q) return true;
      const details = parseTerms(s.terms);
      return (
        s.name.toLowerCase().includes(q) ||
        details.phone.toLowerCase().includes(q) ||
        details.address.toLowerCase().includes(q)
      );
    });
  }, [suppliers, query, showArchived, selectedId]);

  const adjustDiscount = (delta: number) => {
    setDiscountPct((prev) => {
      const next = Math.min(100, Math.max(0, prev + delta));
      return Number(next.toFixed(2));
    });
  };

  const chooseNew = () => {
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

  const save = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!name.trim() || isInactive) return;
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
      setMessage({ text: copy.supplierSaved, isError: false });
      await onChanged();
    } catch (err) {
      setMessage({ text: getSupplierErrorMessage(err, copy), isError: true });
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!selected || selected.status !== "active") return;
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
      setMessage({ text: copy.supplierSaved, isError: false });
      await onChanged();
    } catch (err) {
      setMessage({ text: getSupplierErrorMessage(err, copy), isError: true });
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    if (!selected || selected.status !== "active" || !survivorId) return;
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
      setMessage({ text: copy.supplierSaved, isError: false });
      await onChanged();
    } catch (err) {
      setMessage({ text: getSupplierErrorMessage(err, copy), isError: true });
    } finally {
      setBusy(false);
    }
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
          <label className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-control-border text-primary focus:ring-primary"
            />
            <span>{copy.showArchived}</span>
          </label>
        </div>
        <div className="flex-1 overflow-auto">
          {filteredSuppliers.map((s) => {
            const isSel = s.id === selectedId;
            const details = parseTerms(s.terms);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={isSel}
                onClick={() => setSelectedId(s.id)}
                className={`supplier-tile w-full text-start px-3 py-2 border-b border-border/50 transition hover:bg-primary/10 ${
                  isSel
                    ? "bg-primary/15 border-inline-start-4 border-inline-start-primary"
                    : ""
                } ${s.status !== "active" ? "opacity-75" : ""}`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="text-sm font-bold text-foreground truncate">
                    {s.name}
                  </div>
                  {s.status !== "active" && (
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        s.status === "archived"
                          ? "bg-muted text-muted-foreground border border-control-border"
                          : "bg-warning/15 text-warning border border-warning/30"
                      }`}
                    >
                      {s.status === "archived" ? copy.archived : copy.merged}
                    </span>
                  )}
                </div>
                <div className="text-[11px] mt-0.5">
                  <span className="text-muted-foreground font-mono">
                    {details.phone || "—"}
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-lg text-xs font-bold border transition bg-primary/15 border-primary/40 text-primary hover:bg-primary/25"
              title={copy.newSupplier}
            >
              <span aria-hidden="true">＋</span>
              <span>{copy.add}</span>
            </button>
            <button
              type="button"
              onClick={() => void archive()}
              disabled={!selectedId || busy || isInactive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-lg text-xs font-bold border transition bg-danger/15 border-danger/40 text-danger hover:bg-danger/25 disabled:opacity-40"
              title={
                isInactive
                  ? isArchived
                    ? copy.archived
                    : copy.merged
                  : copy.archiveSupplier
              }
            >
              <span aria-hidden="true">🗑</span>
              <span>{copy.delete}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !name.trim() || isInactive}
            className="px-4 py-1.5 h-8 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:brightness-105 disabled:opacity-40 transition shadow-xs"
          >
            {busy ? "..." : `💾 ${copy.save}`}
          </button>
        </div>

        {message && (
          <div
            role={message.isError ? "alert" : "status"}
            className={`px-4 py-2 border-b border-border text-xs font-bold ${
              message.isError
                ? "bg-danger/15 text-danger border-danger/30"
                : "bg-primary/10 text-primary"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* M2 Supplier profile. Accounting cards remain hidden until M3. */}
        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-3 bg-card border border-border rounded-xl p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2">
                {copy.supplierProfile}
              </h3>
              {selected && selected.status !== "active" && (
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    selected.status === "archived"
                      ? "bg-muted text-muted-foreground border border-control-border"
                      : "bg-warning/15 text-warning border border-warning/30"
                  }`}
                >
                  {selected.status === "archived" ? copy.archived : copy.merged}
                </span>
              )}
            </div>
            <form onSubmit={(e) => void save(e)} className="space-y-3">
              <fieldset
                disabled={isInactive || busy}
                className="space-y-3 border-0 p-0 m-0"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label htmlFor={nameId} className="block">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                      {copy.supplierName}
                    </span>
                    <input
                      id={nameId}
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </label>
                  <label htmlFor={phoneId} className="block">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                      {copy.phone}
                    </span>
                    <input
                      id={phoneId}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </label>
                  <label htmlFor={addressId} className="block">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                      {copy.location}
                    </span>
                    <input
                      id={addressId}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </label>
                  <label htmlFor={paymentTermsId} className="block">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                      {copy.defaultPayment}
                    </span>
                    <select
                      id={paymentTermsId}
                      value={paymentTerms}
                      onChange={(e) =>
                        setPaymentTerms(e.target.value as "credit" | "cash")
                      }
                      className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="credit">{copy.creditTerm}</option>
                      <option value="cash">{copy.cashTerm}</option>
                    </select>
                  </label>
                  <div className="block">
                    <label
                      htmlFor={discountId}
                      className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1"
                    >
                      {copy.allowance}
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => adjustDiscount(-0.5)}
                        className="size-7 grid place-items-center bg-muted border border-control-border rounded hover:bg-danger/20 hover:text-danger text-xs font-bold"
                        aria-label={copy.decreaseAllowance}
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
                        className="flex-1 min-w-0 bg-muted border border-control-border rounded-lg px-3 py-1.5 text-sm text-center font-mono outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <button
                        type="button"
                        onClick={() => adjustDiscount(0.5)}
                        className="size-7 grid place-items-center bg-muted border border-control-border rounded hover:bg-ready/20 hover:text-ready text-xs font-bold"
                        aria-label={copy.increaseAllowance}
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                  <label htmlFor={duePeriodId} className="block">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
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
                      className="w-full bg-muted border border-control-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </label>
                </div>
              </fieldset>
            </form>
            {selected?.status === "active" && activeSuppliers.length > 1 && (
              <div className="pt-3 border-t border-border flex items-center gap-2">
                <label htmlFor={mergeId} className="flex-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                    {copy.mergeInto}
                  </span>
                  <select
                    id={mergeId}
                    value={survivorId}
                    onChange={(e) => setSurvivorId(e.target.value)}
                    className="w-full bg-muted border border-control-border rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/40"
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
        </div>
      </div>
    </section>
  );
}
