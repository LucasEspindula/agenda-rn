// @ts-nocheck
"use client";
import InsurancePending from "./insurance-pending";
import BillingSubnav from "./billing-subnav";
import ProfessionalChargeDialog from "./professional-charge-dialog";
import ProfessionalInvoiceDialog from "./professional-invoice-dialog";
import { filterPendingRows, pendingAction } from "@/lib/insurance-pending";
import PaymentParts, { PaymentPartsReadOnly } from "@/components/payment-parts";
import PaymentProofs, { paymentProofLabel } from "@/components/payment-proofs";
import { cents, validPaymentParts, type PaymentPart } from "@/lib/fiscal-money";
import { financialRefresh } from "@/lib/financial-refresh";
import {
  activeInvoice,
  historicalInvoice,
  compareInvoiceNumbersDesc,
  fiscalStatus,
} from "@/lib/fiscal-document";
import { formatBRL as money, parseBRL, moneyInput } from "@/lib/money";
import { formatDateBR } from "@/lib/date-format";
import {
  notifyFinancialChange,
  isExternalFinancialChange,
} from "@/lib/financial-events";
import { uploadFinancialAttachment } from "@/lib/financial-attachments-client";
import PrivateInvoice from "./private-invoice";
import InvoiceRequests from "./invoice-requests";
import { confirmFiscalPayment } from "@/components/confirm-fiscal-payment";
import type { InvoiceRequest } from "@/lib/billing-types";
import MoneyInput from "@/components/money-input";
import { useCallback, useEffect, useState, useRef } from "react";
import { eligibleForInvoice, payerKey } from "@/lib/billing-eligibility";
import {
  attendanceInsuranceOptions,
  sanitizeAttendanceFilters,
  invoiceRows,
  rowEntityId,
  companyLabel,
  isInsurancePending,
  billingRowKey,
  matchesRow,
  matchesInvoice,
  rowStatus,
  ROW_STATUSES,
  INVOICE_STATUSES,
} from "@/lib/billing-row";
import {
  directPayment as isDirectPayment,
  allowedEntities as entitiesForRow,
} from "@/lib/billing-finance";
import AppDialog from "@/components/app-dialog";
import {
  TrashIcon,
  PrintIcon,
  WalletIcon,
  EditIcon,
  NavIcon,
  CancelFiscalIcon,
  ReplaceInvoiceIcon,
  HistoryIcon,
} from "@/components/billing-icons";
import type { BillingData, BillingRow, Invoice } from "@/lib/billing-types";
import ManualAttendance from "./manual-attendance";
import CompanyFinance from "./company-finance";
import BillingLogs from "./billing-logs";
import { individualReceived, type ReportScope } from "@/lib/billing-reports";
import {
  captureFinancialVersion,
  withExpectedFinancialVersion,
} from "@/lib/financial-concurrency";
type Draft = Record<string, string | number | boolean | null | string[]>;
const empty: BillingData = {
  payers: [],
  rows: [],
  entities: [],
  links: [],
  invoices: [],
  items: [],
  doctors: [],
};
const date = formatDateBR;
const dr = (s: string) => (/^Dr\.?\s/i.test(s) ? s : `Dr. ${s}`);
export default function BillingClient({
  appointmentId,
  initialView,
  professionalBillingEnabled = false,
}: {
  appointmentId?: string;
  initialView?: string;
  professionalBillingEnabled?: boolean;
}) {
  const [pendingSearch, setPendingSearch] = useState("");
  const [pendingSource, setPendingSource] = useState<BillingRow | null>(null),
    [pendingContext, setPendingContext] = useState(false);
  const [parts, setParts] = useState<PaymentPart[]>([]);
  const [lifecycle, setLifecycle] = useState<{
      kind: string;
      id: string;
      updated_at: string;
      label: string;
    } | null>(null),
    [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState<{
    invoice: Invoice;
    reason: string;
  } | null>(null);
  const [historyInvoice, setHistoryInvoice] = useState<Invoice | null>(null);
  const [invoiceView, setInvoiceView] = useState("requests");
  const [privateInvoice, setPrivateInvoice] = useState<
    InvoiceRequest | Invoice | true | null
  >(null);
  const [printMenu, setPrintMenu] = useState(false);
  const [manual, setManual] = useState<BillingRow | true | null>(null);
  const [professionalSource, setProfessionalSource] = useState<BillingRow | null>(null);
  const [professionalEdit, setProfessionalEdit] = useState(false);
  const [professionalInvoice, setProfessionalInvoice] = useState<Invoice | true | null>(null);
  const deepLinkHandled = useRef(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const initialTab =
    initialView === "invoices" ||
    initialView === "insurance" ||
    initialView === "expenses" ||
    initialView === "entities" ||
    initialView === "logs"
      ? initialView
      : "records";
  const [data, setData] = useState<BillingData>(empty),
    [tab, setTab] = useState(initialTab),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const insurancePendingCount = data.rows.filter(isInsurancePending).length;
  const insurancePendingActive = tab === "insurance";
  const pendingCount = (data.requests || []).filter(
    (r) => r.status === "PENDING",
  ).length;
  const [statusFilter, setStatusFilter] = useState(""),
    [printError, setPrintError] = useState("");
  const [entity, setEntity] = useState(""),
    [doctor, setDoctor] = useState(""),
    [insurance, setInsurance] = useState(""),
    [particularPatient, setParticularPatient] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [editing, setEditing] = useState(""),
    [draft, setDraft] = useState<Draft>({}),
    [expectedRecordVersion, setExpectedRecordVersion] = useState<string | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [modalError, setModalError] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null),
    [proofTarget, setProofTarget] = useState<{
      invoiceId?: string;
      billingRecordId?: string;
    } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
      kind: string;
      id: string;
      updated_at: string;
      name: string;
    } | null>(null),
    [deleteError, setDeleteError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false),
    [pickerSelected, setPickerSelected] = useState<string[]>([]),
    [patientSearch, setPatientSearch] = useState(""),
    [pickerDoctor, setPickerDoctor] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [itemStart, setItemStart] = useState(""),
    [itemEnd, setItemEnd] = useState("");
  const refresh = useRef<ReturnType<
    typeof financialRefresh<BillingData>
  > | null>(null);
  const load = useCallback(async (staleOnly = false) => {
    try {
      const j = await refresh.current?.run(staleOnly);
      if (j) {
        setData(j);
        setError("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha de conexão.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh.current = financialRefresh(async () => {
      const r = await fetch(
        "/api/billing" +
          (appointmentId
            ? "?appointment_id=" + encodeURIComponent(appointmentId)
            : ""),
        { cache: "no-store" },
      );
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      return j as BillingData;
    });
    void load();
    const changed = () => void load(),
      focus = () => void load(true);
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("rn-finance")
        : null;
    if (channel)
      channel.onmessage = (e) => {
        if (isExternalFinancialChange(e.data)) changed();
      };
    window.addEventListener("focus", focus);
    window.addEventListener("rn-finance-changed", changed);
    return () => {
      channel?.close();
      window.removeEventListener("focus", focus);
      window.removeEventListener("rn-finance-changed", changed);
      refresh.current = null;
    };
  }, [appointmentId, load]);
  async function fiscalAction() {
    if (!lifecycle || busy || !reason.trim()) return;
    setBusy(true);
    setModalError("");
    try {
      if (lifecycle.kind === "replace_invoice") {
        const i = data.invoices.find((i) => i.id === lifecycle.id)!;
        editInvoice(i);
        setReplacement({ invoice: i, reason });
        setDraft((d) => ({
          ...d,
          invoice_number: "",
          issue_date: new Date().toISOString().slice(0, 10),
          closing_adjustment: 0,
          closing_adjustment_reason: "",
        }));
        setLifecycle(null);
        return;
      }
      const r = await fetch("/api/billing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: lifecycle.kind,
            data: {
              id: lifecycle.id,
              updated_at: lifecycle.updated_at,
              reason,
            },
          }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      setLifecycle(null);
      notifyFinancialChange();
    } catch (e) {
      setModalError(
        e instanceof Error ? e.message : "Não foi possível concluir.",
      );
    } finally {
      setBusy(false);
    }
  }
  const askFiscal = (
    kind: string,
    id: string,
    updated_at: string,
    label: string,
  ) => {
    setReason("");
    setModalError("");
    setLifecycle({ kind, id, updated_at, label });
  };
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("view") === "monthly") {
      setTab("records");
      setDoctor(q.get("doctor") || "");
      setStart(q.get("start") || "");
      setEnd(q.get("end") || "");
    }
  }, []);
  useEffect(() => {
    if (loading || !data.doctors.length || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const q = new URLSearchParams(location.search);
    if (q.get("view") === "monthly") setPrintMenu(true);
  }, [loading, data]);
  const filterDoctors = data.doctors.filter(
    (d) =>
      !insurancePendingActive ||
      !entity ||
      data.links.some(
        (l) => l.billing_entity_id === entity && l.doctor_id === d.id,
      ) ||
      data.rows.some((r) => rowEntityId(r) === entity && r.doctor_id === d.id),
  );
  useEffect(() => {
    if (
      insurancePendingActive &&
      doctor &&
      !filterDoctors.some((d) => d.id === doctor)
    )
      setDoctor("");
  }, [tab, entity, doctor, data.links, data.doctors]);
  useEffect(() => {
    if (tab !== "records") return;
    const sane = sanitizeAttendanceFilters(
      data.rows,
      insurance,
      particularPatient,
    );
    if (sane.insurance !== insurance) setInsurance(sane.insurance);
    if (sane.patient !== particularPatient) setParticularPatient(sane.patient);
  }, [tab, data.rows, insurance, particularPatient]);
  async function remove() {
    if (!confirmDelete || busy) return;
    setBusy(true);
    setDeleteError("");
    try {
      const r = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "delete_" + confirmDelete.kind,
          data: confirmDelete,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setConfirmDelete(null);
      setMessage("Registro excluído.");
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setBusy(false);
    }
  }
  const askDelete = (
    kind: string,
    value: { id: string; updated_at: string },
    name: string,
  ) => {
    setDeleteError("");
    setConfirmDelete({ kind, ...value, name });
  };
  const status = (active: boolean) => (
    <span className={"entity-status " + (active ? "active" : "inactive")}>
      {active ? "Ativo" : "Inativo"}
    </span>
  );
  const doctorName = (id: string) =>
    dr(data.doctors.find((d) => d.id === id)?.name || "Não informado");
  const entityName = (id: string) =>
    data.entities.find((e) => e.id === id)?.name || "Não definida";
  const invoicesForRow = (r: BillingRow) =>
    r.invoice?.invoice_number ||
    r.record?.invoice_number ||
    (r.record?.billing_method === "CONVENIO" &&
    r.record?.settlement_mode === "DIRECT"
      ? "Não gerenciada"
      : "—");
  const proofStatus = (r: BillingRow) =>
    r.invoice?.recipient_type === "CONVENIO" && r.invoice.paid_at
      ? paymentProofLabel(data.attachments, r.invoice.id)
      : r.record?.payment_status === "PAGO"
        ? paymentProofLabel(data.attachments, undefined, r.record.id)
        : "";
  const userName = (id: number | null | undefined) =>
    data.users?.find((u) => u.id === id)?.name || "Não informado";
  const matches = (r: BillingRow) =>
    matchesRow(r, {
      entity,
      doctor,
      insurance,
      patient: particularPatient,
      start,
      end,
      status: statusFilter,
    });
  const pendingRows = filterPendingRows(data, {
    entity,
    doctor,
    insurance,
    start,
    end,
    search: pendingSearch,
  });
  const rows = data.rows
    .filter(matches)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.patient.localeCompare(b.patient),
    );
  const invoices = data.invoices
    .filter(
      (i) =>
        historicalInvoice(i) &&
        matchesInvoice(i, data, {
          entity,
          doctor,
          insurance,
          start,
          end,
          status: statusFilter,
        }),
    )
    .sort(compareInvoiceNumbersDesc);
  const invoiceDoctors = (i: Invoice) => [
    ...new Set(
      invoiceRows(i, data).flatMap(({ row: r }) =>
        [r.doctor_id, r.anesthetist_id].filter(Boolean),
      ),
    ),
  ];
  const multipleInvoiceDoctors =
    new Set(invoices.flatMap(invoiceDoctors)).size > 1;
  function open(kind: string, value: Draft) {
    setPendingContext(false);
    setEditing(kind);
    setDraft(value);
    setExpectedRecordVersion(
      kind === "record" ? captureFinancialVersion(value.updated_at) : null,
    );
    setModalError("");
    setProofFile(null);
    setProofTarget(null);
    setSelected(
      Array.isArray(value.attendance_ids) ? value.attendance_ids : [],
    );
    setPickerOpen(false);
    setPickerSelected([]);
    setPatientSearch("");
    setPickerDoctor("");
    setItemStart("");
    setItemEnd("");
  }
  function editRecord(r: BillingRow) {
    if (professionalBillingEnabled && (!r.record || r.record.professional_id)) {
      setProfessionalSource(r); setProfessionalEdit(!!r.record); return;
    }
    setParts(
      (data.payment_parts || []).filter(
        (p) => p.billing_record_id === r.record?.id,
      ),
    );
    open("record", {
      ...(r.record || {}),
      attendance_id: r.attendance_id,
      billing_entity_id: r.record?.billing_entity_id || "",
      billing_method:
        r.forma_cobranca || r.record?.billing_method || "PARTICULAR",
      payment_status: r.record?.payment_status || "PENDENTE",
      received_amount: r.record?.received_amount ?? "",
      invoice_number: r.record?.invoice_number || "",
      paid_at: r.record?.paid_at || "",
      notes: r.record?.notes || "",
    });
  }
  function editInvoice(i?: Invoice) {
    if (professionalBillingEnabled && i && invoiceRows(i,data).some(({row}) => !!row.record?.professional_id)) {
      setProfessionalInvoice(i);
      return;
    }
    setReplacement(null);
    setParts(
      (data.payment_parts || []).filter((p) => !!i && p.invoice_id === i.id),
    );
    if (i?.recipient_type === "PARTICULAR") {
      setPrivateInvoice(i);
      return;
    }
    setAmounts(
      Object.fromEntries(
        data.rows
          .filter((r) => r.invoice?.id === i?.id && i)
          .map((r) => [
            r.attendance_id,
            moneyInput(r.invoice_item?.received_amount),
          ]),
      ),
    );
    open(
      "invoice",
      i
        ? {
            ...i,
            payer: payerKey(i.payer),
            attendance_ids: data.rows
              .filter((r) => r.invoice?.id === i.id)
              .map((r) => r.attendance_id),
          }
        : {
            billing_entity_id: entity,
            payer: payerKey(insurance),
            invoice_number: "",
            issue_date: new Date().toISOString().slice(0, 10),
            paid_at: "",
            total_amount: "",
            net_amount: "",
            closing_adjustment: 0,
            closing_adjustment_reason: "",
            notes: "",
            attendance_ids: [],
          },
    );
  }
  function resolvePending(row: BillingRow) {
    const action = pendingAction(row, data);
    if (action.kind === "invoice") {
      editInvoice(row.invoice!);
      setPendingContext(true);
    } else if (action.kind === "payment") {
      editRecord(row);
      setDraft((d) => ({ ...d, billing_entity_id: rowEntityId(row) }));
      setPendingContext(true);
    } else setPendingSource(row);
  }
  const pendingInvoices = pendingSource
    ? data.invoices.filter(
        (i) =>
          activeInvoice(i) &&
          i.recipient_type !== "PARTICULAR" &&
          !i.paid_at &&
          (!rowEntityId(pendingSource) ||
            i.billing_entity_id === rowEntityId(pendingSource)) &&
          eligibleForInvoice(
            pendingSource,
            data,
            i.billing_entity_id,
            i.payer,
            i.id,
          ),
      )
    : [];
  function linkPending(invoice?: Invoice) {
    if (!pendingSource) return;
    const row = pendingSource;
    if (professionalBillingEnabled && row.record?.professional_id) {
      setPendingSource(null);
      setProfessionalInvoice(invoice || true);
      return;
    }
    editInvoice(invoice);
    setPendingContext(true);
    if (invoice)
      setSelected((ids) => [...new Set([...ids, row.attendance_id])]);
    else {
      const id = rowEntityId(row);
      setDraft((d) => ({
        ...d,
        billing_entity_id: id,
        payer: payerKey(row.insurance),
      }));
      if (eligibleForInvoice(row, data, id, row.insurance))
        setSelected([row.attendance_id]);
    }
    setPendingSource(null);
  }
  const set = (key: string, value: string | boolean) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (
      editing === "invoice" &&
      (!draft.billing_entity_id ||
        !draft.payer ||
        !draft.invoice_number ||
        !draft.issue_date)
    ) {
      setModalError("Preencha empresa, pagador, número e emissão.");
      return;
    }
    setBusy(true);
    setModalError("");
    try {
      let fiscal;
      if (
        editing === "record" &&
        draft.billing_method === "PARTICULAR" &&
        draft.payment_status === "PAGO" &&
        !draft.invoice_number &&
        !(data.requests || []).some(
          (r) =>
            r.attendance_id === draft.attendance_id && r.status !== "CANCELLED",
        )
      ) {
        fiscal = await confirmFiscalPayment({
          patient: data.patients?.find(
            (p) => p.id === currentRow?.patient_id,
          ) || {
            id: currentRow?.patient_id || "",
            name: currentRow?.patient || "",
          },
          amount: parseBRL(draft.received_amount),
          paidAt: String(draft.paid_at || ""),
        });
        if (!fiscal) return;
      }
      const payload = withExpectedFinancialVersion(
        {
          ...draft,
          ...(fiscal
            ? { fiscal, payment_parts: fiscal.payment_parts }
            : editing === "record" &&
                draft.billing_method === "PARTICULAR" &&
                draft.payment_status === "PAGO" &&
                parts.length
              ? { payment_parts: parts }
              : {}),
          ...Object.fromEntries(
            ["received_amount", "total_amount", "net_amount"]
              .filter((key) => key in draft)
              .map((key) => [key, parseBRL(draft[key])]),
          ),
          ...(editing === "record" &&
          draft.billing_method === "CONVENIO" &&
          !directPayment
            ? { payment_status: "PENDENTE" }
            : {}),
          ...(editing === "invoice"
            ? {
                attendance_ids: selected,
                item_amounts: Object.fromEntries(
                  selected.map((id) => [id, parseBRL(amounts[id])]),
                ),
              }
            : {}),
        },
        editing,
        expectedRecordVersion,
      );
      if (editing === "invoice") {
        if (
          !selected.length ||
          selected.some((id) => parseBRL(amounts[id]) == null)
        )
          throw Error("Informe o valor de cada atendimento.");
        if (
          selected.reduce((n, id) => n + cents(parseBRL(amounts[id]) ?? 0), 0) +
            cents(String(draft.closing_adjustment || 0)) !==
          cents(parseBRL(draft.net_amount) ?? 0)
        )
          throw Error(
            "A soma dos itens e eventual ajuste histórico deve ser igual ao valor líquido.",
          );
        Object.assign(payload, {
          recipient_type: "CONVENIO",
          closing_adjustment:
            cents(String(draft.closing_adjustment || 0)) / 100,
          closing_adjustment_reason: String(
            draft.closing_adjustment_reason || "",
          ),
          payment_parts: parts,
        });
        if (
          draft.paid_at &&
          !validPaymentParts(parts, parseBRL(draft.net_amount) ?? 0)
        )
          throw Error("As formas de pagamento devem somar o valor líquido.");
      }
      const r = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          replacement && editing === "invoice"
            ? {
                kind: "replace_invoice",
                data: {
                  id: replacement.invoice.id,
                  updated_at: replacement.invoice.updated_at,
                  reason: replacement.reason,
                  replacement: payload,
                },
              }
            : { kind: editing, data: payload },
        ),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const target =
          editing === "record"
            ? { billingRecordId: String(j.id) }
            : editing === "invoice"
              ? { invoiceId: String(j.id) }
              : null,
        shouldUpload =
          !!proofFile &&
          !!target &&
          ((editing === "record" && payload.payment_status === "PAGO") ||
            (editing === "invoice" && !!draft.paid_at));
      if (shouldUpload) {
        try {
          await uploadFinancialAttachment(proofFile!, target!);
          setProofFile(null);
          setProofTarget(null);
        } catch {
          setProofTarget(target);
          setMessage("Pagamento salvo. O comprovante não foi enviado.");
          setModalError(
            "⚠ O comprovante não foi enviado. Tente novamente sem salvar o pagamento outra vez.",
          );
          notifyFinancialChange();
          await load();
          return;
        }
      }
      setEditing("");
      setMessage(
        shouldUpload ? "Pagamento e comprovante salvos." : "Alteração salva.",
      );
      notifyFinancialChange();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function retryProof() {
    if (!proofTarget || !proofFile || busy) return;
    setBusy(true);
    setModalError("");
    try {
      await uploadFinancialAttachment(proofFile, proofTarget);
      setProofFile(null);
      setProofTarget(null);
      setMessage("Comprovante anexado.");
      notifyFinancialChange();
      await load();
      setEditing("");
    } catch (e) {
      setModalError(
        e instanceof Error
          ? e.message
          : "O pagamento foi mantido, mas o comprovante não foi enviado. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  function field(
    key: string,
    label: string,
    type = "text",
    required = false,
    disabled = false,
  ) {
    if (type === "number")
      return (
        <label>
          {label}
          <MoneyInput
            name={key}
            required={required}
            disabled={disabled}
            value={draft[key] as number | string | null}
            onChange={(value) => set(key, value)}
          />
        </label>
      );
    return (
      <label>
        {label}
        <input
          name={key}
          type={type}
          required={required}
          disabled={disabled}
          value={String(draft[key] ?? "")}
          onChange={(e) => {
            set(key, e.target.value);
            if (key === "payer") setSelected([]);
          }}
          {...(type === "number" ? { min: 0, step: "0.01" } : {})}
        />
      </label>
    );
  }
  const currentRow = data.rows.find(
    (r) => r.attendance_id === draft.attendance_id,
  );
  const directPayment =
    !!currentRow &&
    isDirectPayment(currentRow, data, String(draft.billing_method || ""));
  const allowedEntities = currentRow ? entitiesForRow(currentRow, data) : [];
  const options = (values: { id: string; name: string }[]) =>
    values.map((v) => (
      <option key={v.id} value={v.id}>
        {v.name}
      </option>
    ));
  const nfCandidates = data.rows.filter(
    (r) =>
      (!professionalBillingEnabled || !r.record?.professional_id) &&
      eligibleForInvoice(
        r,
        data,
        String(draft.billing_entity_id || ""),
        String(draft.payer || ""),
        typeof draft.id === "string" ? draft.id : undefined,
      ) &&
      !selected.includes(r.attendance_id) &&
      (!patientSearch ||
        r.patient
          .toLocaleLowerCase("pt-BR")
          .includes(patientSearch.trim().toLocaleLowerCase("pt-BR"))) &&
      (!pickerDoctor ||
        [r.doctor_id, r.anesthetist_id].includes(pickerDoctor)) &&
      (!itemStart || r.date >= itemStart) &&
      (!itemEnd || r.date <= itemEnd),
  );
  const amountInput = (r: BillingRow) => (
    <MoneyInput
      aria-label={"Valor recebido de " + r.patient}
      placeholder="Não informado"
      value={amounts[r.attendance_id] || ""}
      onChange={(value) =>
        setAmounts((values) => ({ ...values, [r.attendance_id]: value }))
      }
    />
  );
  const safeAmount = (v: unknown) => {
    try {
      return parseBRL(v) ?? 0;
    } catch {
      return 0;
    }
  };
  const linkedRows = data.rows.filter((r) =>
    selected.includes(r.attendance_id),
  );
  const payerOptions = [
    ...new Set(
      (data.payers || data.rows.map((r) => r.insurance))
        .map(payerKey)
        .filter(Boolean),
    ),
  ].sort();
  const recordInsuranceOptions = attendanceInsuranceOptions(data.rows);
  const pickerDoctors = data.doctors.filter((d) =>
    data.links.some(
      (l) =>
        l.active &&
        l.doctor_id === d.id &&
        l.billing_entity_id === draft.billing_entity_id,
    ),
  );
  function openPicker() {
    setPickerSelected([]);
    setPatientSearch("");
    setPickerDoctor("");
    setItemStart("");
    setItemEnd("");
    setPickerOpen(true);
  }

  const table = (items: BillingRow[], report = false) => (
    <div className="billing-panel">
      <table className="billing-table billing-attendance-table">
        <thead>
          <tr>
            <th>Paciente / origem</th>
            <th>Data</th>
            <th>Procedimento</th>
            <th>Convênio</th>
            {!report && <th>Médico</th>}
            <th>Empresa</th>
            <th>Cobrança</th>
            <th>NF/Lote</th>
            {insurancePendingActive && <th>Emissão</th>}
            <th>Valor recebido</th>
            <th>Pagamento</th>
            <th>Status</th>
            {insurancePendingActive && <th>Em aberto</th>}
            {!report && (
              <>
                <th>Cadastrado por</th>
                <th className="no-print">Ações</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={billingRowKey(r)}>
              <td>
                {r.patient}
                <small className="billing-origin">
                  {r.origin === "AGENDA" ? "Agenda" : "Manual"}
                </small>
              </td>
              <td>{date(r.date)}</td>
              <td>{r.procedure}</td>
              <td>{r.insurance || "—"}</td>
              {!report && <td>{doctorName(r.doctor_id)}</td>}
              <td
                className="billing-company-cell"
                title={companyLabel(data, rowEntityId(r))}
              >
                {companyLabel(data, rowEntityId(r))}
              </td>
              <td>
                {r.forma_cobranca === "CONVENIO"
                  ? "Convênio"
                  : r.forma_cobranca === "PARTICULAR"
                    ? "Particular"
                    : "—"}
              </td>
              <td>
                {invoicesForRow(r)}
                {r.record?.billing_method === "PARTICULAR" && (
                  <small className="billing-origin">
                    NF:{" "}
                    {r.invoice
                      ? "Emitida"
                      : data.requests?.some(
                            (q) =>
                              q.attendance_id === r.attendance_id &&
                              q.status === "PENDING",
                          )
                        ? "Solicitada"
                        : data.requests?.some(
                              (q) =>
                                q.attendance_id === r.attendance_id &&
                                q.status === "CANCELLED",
                            )
                          ? "Cancelada"
                          : "Sem solicitação"}
                  </small>
                )}
              </td>
              {insurancePendingActive && <td>{date(r.invoice?.issue_date)}</td>}
              <td>{money(individualReceived(r))}</td>
              <td>
                {date(r.invoice?.paid_at || r.record?.paid_at)}
                {proofStatus(r) && (
                  <small className="billing-origin">{proofStatus(r)}</small>
                )}
              </td>
              <td>
                <span
                  className={
                    "billing-badge " +
                    (rowStatus(r) === "Pago" ? "paid" : "pending")
                  }
                >
                  {rowStatus(r)}
                </span>
              </td>
              {insurancePendingActive && (
                <td>
                  {Math.max(
                    0,
                    Math.floor(
                      (Date.now() - new Date(r.date + "T00:00:00").getTime()) /
                        86400000,
                    ),
                  )}{" "}
                  dias
                </td>
              )}
              {!report && (
                <>
                  <td>{userName(r.created_by)}</td>
                  <td className="no-print">
                    <button
                      className="billing-icon-action"
                      aria-label="Abrir financeiro"
                      title="Financeiro"
                      onClick={() => editRecord(r)}
                    >
                      <WalletIcon />
                    </button>
                    {professionalBillingEnabled && tab === "records" && !!r.record && r.status_atendimento !== "cancelled" &&
                      [...new Set([r.clinical_doctor_id || r.doctor_id, r.anesthetist_id].filter(Boolean))]
                        .some(id => !data.rows.some(other => other.attendance_id === r.attendance_id && other.record?.professional_id === id)) && (
                        <button type="button" className="billing-secondary" title="Nova cobrança por profissional"
                          onClick={() => { setProfessionalEdit(false); setProfessionalSource(r); }}>+ Cobrança</button>
                      )}
                    {r.origin !== "AGENDA" &&
                      r.status_atendimento !== "cancelled" && (
                        <button
                          className="billing-icon-action billing-edit"
                          aria-label="Editar atendimento"
                          title="Atendimento"
                          onClick={() => setManual(r)}
                        >
                          <EditIcon />
                        </button>
                      )}
                    {r.origin !== "AGENDA" &&
                      r.status_atendimento !== "cancelled" && (
                        <button
                          className="billing-icon-action billing-delete"
                          disabled={!!r.invoice}
                          title={
                            r.invoice
                              ? "Remova ou regularize a Nota Fiscal vinculada antes de cancelar este atendimento."
                              : "Cancelar atendimento manual"
                          }
                          aria-label={"Cancelar atendimento de " + r.patient}
                          onClick={() =>
                            askFiscal(
                              "cancel_attendance",
                              r.attendance_id,
                              r.updated_at,
                              "Cancelar atendimento de " + r.patient,
                            )
                          }
                        >
                          <TrashIcon />
                        </button>
                      )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <p className="billing-empty">
          Nenhum atendimento encontrado neste filtro.
        </p>
      )}
    </div>
  );
  function openBillingReport(scope: ReportScope) {
    const params = new URLSearchParams();
    Object.entries(scope).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
    window.open(
      "/api/reports/billing?" + params.toString(),
      "_blank",
      "noopener,noreferrer",
    );
  }
  function generateReport(kind: ReportScope["kind"]) {
    if (kind === "doctor" && !doctor) {
      setPrintError(
        "Selecione um médico nos filtros para gerar o relatório do médico.",
      );
      return;
    }
    if (kind === "entity" && !entity) {
      setPrintError(
        "Selecione uma empresa / entidade recebedora para gerar o relatório da empresa.",
      );
      return;
    }
    if (["doctor", "entity"].includes(kind) && (!start || !end)) {
      setPrintError("Informe as datas De e Até para gerar este relatório.");
      return;
    }
    if (start && end && start > end) {
      setPrintError("A data Até deve ser igual ou posterior à data De.");
      return;
    }
    const scope = {
      kind,
      doctor,
      entity,
      start,
      end,
      insurance,
      patient: particularPatient,
      status: statusFilter,
      issued_at: new Date().toISOString(),
    };
    try {
      openBillingReport(scope);
      setPrintError("");
      setError("");
      setPrintMenu(false);
    } catch (e) {
      setPrintError(
        e instanceof Error ? e.message : "Não foi possível gerar o relatório.",
      );
    }
  }
  const filterBar = !appointmentId &&
    !["entities", "expenses", "logs"].includes(tab) &&
    !(tab === "invoices" && invoiceView === "requests") && (
      <div className="billing-filter-bar no-print">
        <div className="billing-filters">
          <label>
            Empresa / entidade recebedora
            <select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">Todas</option>
              {options(data.entities)}
            </select>
          </label>
          <label>
            Médico
            <select value={doctor} onChange={(e) => setDoctor(e.target.value)}>
              <option value="">Todos</option>
              {options(filterDoctors.map((d) => ({ ...d, name: dr(d.name) })))}
            </select>
          </label>
          {tab === "records" ? (
            <>
              <label>
                Convênio / Pagador
                <select
                  value={insurance}
                  onChange={(e) => {
                    setInsurance(e.target.value);
                    if (e.target.value !== "PARTICULAR")
                      setParticularPatient("");
                  }}
                >
                  <option value="">Todos</option>
                  <option value="PARTICULAR">Particular</option>
                  {recordInsuranceOptions.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
              <label className="billing-filter-patient">
                Paciente
                <input
                  type="search"
                  disabled={insurance !== "PARTICULAR"}
                  value={insurance === "PARTICULAR" ? particularPatient : ""}
                  onChange={(e) => setParticularPatient(e.target.value)}
                  placeholder={
                    insurance === "PARTICULAR"
                      ? "Buscar por nome"
                      : "Selecione Particular para filtrar"
                  }
                />
              </label>
            </>
          ) : (
            <label>
              Convênio / Pagador
              <select
                value={insurance}
                onChange={(e) => setInsurance(e.target.value)}
              >
                <option value="">Todos</option>
                {(tab === "invoices"
                  ? data.invoices.filter(historicalInvoice).map((i) => i.payer)
                  : data.rows.map((r) => r.insurance)
                )
                  .filter(Boolean)
                  .filter(
                    (value, index, values) =>
                      values.findIndex(
                        (v) =>
                          v.trim().toLocaleLowerCase("pt-BR") ===
                          value.trim().toLocaleLowerCase("pt-BR"),
                      ) === index,
                  )
                  .sort()
                  .map((i) => (
                    <option key={i}>{i}</option>
                  ))}
              </select>
            </label>
          )}
          {!insurancePendingActive && (
            <label>
              Status
              <select
                aria-label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {(tab === "invoices" ? INVOICE_STATUSES : ROW_STATUSES).map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </label>
          )}
          <label>
            De
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          {insurancePendingActive && (
            <>
              <label>
                Paciente / Procedimento
                <input
                  type="search"
                  value={pendingSearch}
                  onChange={(e) => setPendingSearch(e.target.value)}
                  placeholder="Buscar..."
                />
              </label>
              <button
                className="billing-icon-action pending-clear-filters"
                title="Limpar filtros"
                aria-label="Limpar filtros"
                onClick={() => {
                  setEntity("");
                  setDoctor("");
                  setInsurance("");
                  setStart("");
                  setEnd("");
                  setPendingSearch("");
                  setStatusFilter("");
                }}
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
        <div className="billing-filter-action">
          {professionalBillingEnabled && tab === "invoices" && (
            <button type="button" className="billing-secondary"
              onClick={() => setProfessionalInvoice(true)}
              title="Criar uma NF vinculando cobranças profissionais por ID">
              + NF profissional
            </button>
          )}
          {!insurancePendingActive && (
            <button
              className="billing-icon-action billing-add"
              aria-label={
                tab === "invoices" ? "Nova NF / lote" : "Novo atendimento"
              }
              title={tab === "invoices" ? "Nova NF / lote" : "Novo atendimento"}
              onClick={() =>
                tab === "invoices" ? editInvoice() : setManual(true)
              }
            >
              +
            </button>
          )}
          <button
            className="billing-icon-action"
            aria-label="Imprimir / gerar relatório"
            title="Imprimir / gerar relatório"
            disabled={loading}
            onClick={() => {
              if (tab === "records") {
                setPrintError("");
                setPrintMenu(true);
              } else if (insurancePendingActive) setPrintPending(true);
              else generateReport("invoices");
            }}
          >
            <PrintIcon />
          </button>
        </div>
      </div>
    );
  return (
    <>
      {!appointmentId && (
        <BillingSubnav
          active={tab}
          pendingCount={pendingCount}
          insurancePendingCount={insurancePendingCount}
        />
      )}
      <main
        className={
          "billing-main" + (tab === "insurance" ? " insurance-main" : "")
        }
      >
        {appointmentId && (
          <div className="billing-heading">
            <h1 className="billing-title">Financeiro do atendimento</h1>
          </div>
        )}
        {tab === "invoices" && (
          <nav className="billing-tabs" aria-label="Notas Fiscais">
            <button
              aria-current={invoiceView === "requests" ? "page" : undefined}
              onClick={() => setInvoiceView("requests")}
            >
              <NavIcon kind="requests" />
              Solicitações{" "}
              {pendingCount > 0 && (
                <span className="fiscal-count">{pendingCount}</span>
              )}
            </button>
            <button
              aria-current={invoiceView === "issued" ? "page" : undefined}
              onClick={() => setInvoiceView("issued")}
            >
              <NavIcon kind="invoices" />
              Notas emitidas
            </button>
          </nav>
        )}
        {tab !== "insurance" && filterBar}
        {error && (
          <p role="alert" className="billing-error">
            {error}{" "}
            <button onClick={() => void load()}>Tentar novamente</button>
          </p>
        )}
        {message && (
          <p role="status" className="billing-message no-print">
            {message}
          </p>
        )}
        {loading ? (
          <p className="billing-empty">Carregando…</p>
        ) : (
          <>
            {tab === "records" && table(rows)}
            {tab === "insurance" && (
              <section className="insurance-view-frame">
                <InsurancePending
                  filters={filterBar}
                  data={data}
                  rows={pendingRows}
                  onResolve={resolvePending}
                  reportUrl={(extra) =>
                    openBillingReport({
                      kind: "pending",
                      doctor,
                      entity: extra?.entity || entity,
                      start,
                      end,
                      insurance: extra?.insurance || insurance,
                      issued_at: new Date().toISOString(),
                    })
                  }
                />
              </section>
            )}
            {tab === "expenses" && (
              <CompanyFinance data={data} onChanged={() => void load()} />
            )}
            {tab === "logs" && <BillingLogs data={data} />}
            {tab === "invoices" && (
              <>
                {invoiceView === "requests" ? (
                  <InvoiceRequests
                    data={data}
                    onIssue={setPrivateInvoice}
                    onReview={editRecord}
                  />
                ) : (
                  <div className="billing-panel">
                    <table className="billing-table billing-invoice-table">
                      <thead>
                        <tr>
                          <th>NF</th>
                          <th>Tipo</th>
                          <th>Empresa</th>
                          <th>Tomador</th>
                          {multipleInvoiceDoctors && (
                            <th>Médicos / Colaboradores</th>
                          )}
                          <th>Emissão</th>
                          <th>Pagamento</th>
                          <th>Valor bruto</th>
                          <th>Valor líquido</th>
                          <th>Situação fiscal</th>
                          <th>Status do pagamento</th>
                          <th>Emitido por</th>
                          <th className="no-print billing-actions-cell">
                            Ações
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map((i) => (
                          <tr
                            key={i.id}
                            className={
                              i.status === "CANCELLED"
                                ? "invoice-row-cancelled"
                                : i.status === "REPLACED"
                                  ? "invoice-row-replaced"
                                  : undefined
                            }
                          >
                            <td>{i.invoice_number}</td>
                            <td>
                              {i.recipient_type === "PARTICULAR"
                                ? "Particular"
                                : "Convênio"}
                            </td>
                            <td>
                              {data.requests?.find((r) => r.invoice_id === i.id)
                                ?.entity_name_snapshot ||
                                entityName(i.billing_entity_id)}
                            </td>
                            <td>{i.recipient_name || i.payer}</td>
                            {multipleInvoiceDoctors && (
                              <td>
                                {invoiceDoctors(i).map(doctorName).join(" / ")}
                              </td>
                            )}
                            <td>{date(i.issue_date)}</td>
                            <td>{date(i.paid_at)}</td>
                            <td>{money(i.total_amount)}</td>
                            <td>{money(i.net_amount)}</td>
                            <td>
                              {fiscalStatus(i)}
                              {i.allocation_verified === false && (
                                <small className="billing-origin">
                                  Distribuição legada a revisar
                                </small>
                              )}
                            </td>
                            <td>
                              {i.paid_at ? "Pago" : "Aguardando pagamento"}
                            </td>
                            <td>{userName(i.created_by)}</td>
                            <td className="no-print billing-actions-cell">
                              {activeInvoice(i) ? (
                                <div className="billing-row-actions">
                                  <button
                                    className="billing-icon-action billing-edit"
                                    title="Editar NF"
                                    aria-label={"Editar NF " + i.invoice_number}
                                    onClick={() => editInvoice(i)}
                                  >
                                    <EditIcon />
                                  </button>
                                  <button
                                    className="billing-icon-action billing-delete"
                                    title="Desfazer lançamento interno"
                                    aria-label={
                                      "Desfazer NF " + i.invoice_number
                                    }
                                    onClick={() =>
                                      askFiscal(
                                        "undo_invoice",
                                        i.id,
                                        i.updated_at,
                                        "Desfazer lançamento da NF " +
                                          i.invoice_number,
                                      )
                                    }
                                  >
                                    <TrashIcon />
                                  </button>
                                  <button
                                    className="billing-icon-action billing-history"
                                    title="Histórico"
                                    aria-label={
                                      "Histórico da NF " + i.invoice_number
                                    }
                                    onClick={() => setHistoryInvoice(i)}
                                  >
                                    <HistoryIcon />
                                  </button>
                                  <button
                                    className="billing-icon-action billing-cancel"
                                    title="Cancelar fiscalmente"
                                    aria-label={
                                      "Cancelar fiscalmente a NF " +
                                      i.invoice_number
                                    }
                                    onClick={() =>
                                      askFiscal(
                                        "cancel_invoice",
                                        i.id,
                                        i.updated_at,
                                        "Cancelar fiscalmente a NF " +
                                          i.invoice_number,
                                      )
                                    }
                                  >
                                    <CancelFiscalIcon />
                                  </button>
                                  <button
                                    className="billing-icon-action billing-replace"
                                    title="Substituir NF"
                                    aria-label={
                                      "Substituir NF " + i.invoice_number
                                    }
                                    onClick={() =>
                                      askFiscal(
                                        "replace_invoice",
                                        i.id,
                                        i.updated_at,
                                        "Substituir NF " + i.invoice_number,
                                      )
                                    }
                                  >
                                    <ReplaceInvoiceIcon />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="billing-icon-action billing-history"
                                  title="Histórico"
                                  aria-label={
                                    "Histórico da NF " + i.invoice_number
                                  }
                                  onClick={() => setHistoryInvoice(i)}
                                >
                                  <HistoryIcon />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!invoices.length && (
                      <p className="billing-empty">
                        Nenhuma nota fiscal neste período.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {tab === "entities" && (
              <>
                <div className="billing-section-head page-description-head">
                  <p className="page-description">
                    Cadastre os CPF/CNPJ utilizados para receber pagamentos e
                    emitir notas fiscais.
                  </p>
                  <button
                    className="billing-primary"
                    onClick={() =>
                      open("entity", {
                        person_type: "PJ",
                        name: "",
                        trade_name: "",
                        tax_id: "",
                        active: true,
                      })
                    }
                  >
                    + Cadastrar entidade
                  </button>
                </div>
                <div className="billing-panel">
                  <table className="billing-table billing-admin-table">
                    <thead>
                      <tr>
                        <th>Nome fantasia</th>
                        <th>Nome / Razão social</th>
                        <th>Tipo</th>
                        <th>CPF/CNPJ</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.entities.map((e) => (
                        <tr key={e.id}>
                          <td>{e.trade_name || "—"}</td>
                          <td>{e.name}</td>
                          <td>{e.person_type}</td>
                          <td>{e.tax_id}</td>
                          <td>{status(e.active)}</td>
                          <td>
                            <div className="billing-row-actions">
                              <button
                                className="billing-icon-action billing-edit"
                                title="Editar entidade"
                                aria-label={"Editar entidade " + e.name}
                                onClick={() => open("entity", { ...e })}
                              >
                                <EditIcon />
                              </button>
                              <button
                                className="billing-delete"
                                aria-label={"Excluir entidade " + e.name}
                                onClick={() => askDelete("entity", e, e.name)}
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.entities.length && (
                    <p className="billing-empty">
                      Nenhuma entidade recebedora cadastrada.
                    </p>
                  )}
                </div>
              </>
            )}
          </>
        )}
        {pendingSource && (
          <AppDialog
            label="Criar / vincular NF"
            onClose={() => setPendingSource(null)}
          >
            <h2>Criar / vincular NF</h2>
            <p>
              {pendingSource.patient} · {date(pendingSource.date)} ·{" "}
              {pendingSource.insurance}
            </p>
            <p>
              Selecione uma NF ativa ainda não paga ou crie uma nova nota para
              este atendimento.
            </p>
            <div className="billing-print-choices">
              {pendingInvoices.map((i) => (
                <button
                  key={i.id}
                  className="billing-secondary"
                  onClick={() => linkPending(i)}
                >
                  Vincular à NF {i.invoice_number} ·{" "}
                  {companyLabel(data, i.billing_entity_id)}
                </button>
              ))}
              <button className="billing-primary" onClick={() => linkPending()}>
                Criar nova NF
              </button>
              <button
                className="billing-secondary"
                onClick={() => setPendingSource(null)}
              >
                Voltar
              </button>
            </div>
          </AppDialog>
        )}
        {printMenu && (
          <AppDialog
            label="Imprimir / gerar relatório"
            onClose={() => {
              setPrintError("");
              setPrintMenu(false);
            }}
            compact
          >
            <div className="billing-print-dialog">
              <span className="billing-print-eyebrow">Faturamento</span>
              <h2>Imprimir / gerar relatório</h2>
              <p>Escolha o documento conforme os filtros aplicados acima.</p>
              <div className="billing-print-choices">
                {[
                  [
                    "filtered",
                    "Atendimentos filtrados",
                    "Lista os atendimentos visíveis com os filtros atuais.",
                  ],
                  [
                    "doctor",
                    "Relatório do médico",
                    "Requer médico e período selecionados.",
                  ],
                  [
                    "entity",
                    "Relatório da empresa / PJ",
                    "Requer empresa / entidade e período selecionados.",
                  ],
                ].map(([kind, label, description]) => (
                  <button
                    className="billing-print-choice"
                    key={kind}
                    onClick={() => generateReport(kind as ReportScope["kind"])}
                  >
                    <strong>{label}</strong>
                    <span>{description}</span>
                  </button>
                ))}
              </div>
              {printError && (
                <p role="alert" className="billing-error">
                  {printError}
                </p>
              )}
              <div className="billing-modal-actions">
                <button
                  className="billing-secondary"
                  onClick={() => {
                    setPrintError("");
                    setPrintMenu(false);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </AppDialog>
        )}
        {privateInvoice && (
          <PrivateInvoice
            data={data}
            initial={privateInvoice === true ? null : privateInvoice}
            replacement={replacement}
            onClose={() => setPrivateInvoice(null)}
            onInsurance={() => {
              setPrivateInvoice(null);
              editInvoice();
            }}
            onSaved={() => {
              setInvoiceView("issued");
              setMessage("NF registrada.");
              setReplacement(null);
            }}
          />
        )}
        {manual && (
          <ManualAttendance
            data={data}
            row={manual === true ? undefined : manual}
            onClose={() => setManual(null)}
            onSaved={() => void load()}
          />
        )}
        {historyInvoice && (
          <AppDialog
            label="Histórico da NF"
            onClose={() => setHistoryInvoice(null)}
          >
            <h2>NF {historyInvoice.invoice_number}</h2>
            <p>
              {fiscalStatus(historyInvoice)} ·{" "}
              {historyInvoice.recipient_name || historyInvoice.payer}
            </p>
            <div className="billing-panel">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Data</th>
                    <th>Procedimento</th>
                    <th>Médico</th>
                    <th>Valor do item</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceRows(historyInvoice, data).map(({ row, amount }) => (
                    <tr key={row.attendance_id}>
                      <td>{row.patient}</td>
                      <td>{date(row.date)}</td>
                      <td>{row.procedure}</td>
                      <td>{doctorName(row.doctor_id)}</td>
                      <td>{money(amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Vínculos históricos preservados. Documento fora dos totais
              válidos.
            </p>
          </AppDialog>
        )}
        {professionalInvoice && professionalBillingEnabled && (
          <ProfessionalInvoiceDialog data={data} initial={professionalInvoice === true ? null : professionalInvoice}
            onClose={() => setProfessionalInvoice(null)}
            onSaved={() => { setProfessionalInvoice(null); notifyFinancialChange(); void load(); }} />
        )}
        {professionalSource && professionalBillingEnabled && (
          <ProfessionalChargeDialog source={professionalSource} edit={professionalEdit} data={data}
            onClose={() => setProfessionalSource(null)}
            onSaved={() => { setProfessionalSource(null); notifyFinancialChange(); void load(); }}/>
        )}
        {editing && (
          <AppDialog
            label="Configuração financeira"
            onClose={() => setEditing("")}
            busy={busy}
          >
            <div className="billing-section-head">
              <h2 id="financial-title">
                {
                  {
                    entity: "Entidade recebedora",
                    record: "Financeiro do atendimento",
                    invoice: "Nota Fiscal / lote",
                  }[editing]
                }
              </h2>
              <button
                disabled={busy}
                className="billing-secondary"
                onClick={() => setEditing("")}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <form onSubmit={save} noValidate={editing === "invoice"}>
              {editing === "entity" && (
                <div className="billing-form-grid">
                  <label>
                    Tipo de pessoa
                    <select
                      value={String(draft.person_type)}
                      onChange={(e) => set("person_type", e.target.value)}
                    >
                      <option>PJ</option>
                      <option>PF</option>
                    </select>
                  </label>
                  {field("name", "Nome / Razão social", "text", true)}
                  {field("trade_name", "Nome fantasia")}
                  {field(
                    "tax_id",
                    draft.person_type === "PF" ? "CPF" : "CNPJ",
                    "text",
                    true,
                  )}
                  <label className="billing-check">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.active)}
                      onChange={(e) => set("active", e.target.checked)}
                    />
                    Ativa
                  </label>
                </div>
              )}
              {editing === "record" && currentRow && (
                <>
                  <p>
                    {currentRow.patient} · {date(currentRow.date)} ·{" "}
                    {doctorName(currentRow.doctor_id)}
                  </p>
                  {currentRow.invoice ? (
                    <div className="billing-message">
                      NF {currentRow.invoice.invoice_number} · Pagamento:{" "}
                      {date(currentRow.invoice.paid_at)} ·{" "}
                      {currentRow.invoice.paid_at ? "Pago" : "Pendente"}. Dados
                      herdados da NF/lote.
                      {currentRow.invoice.recipient_type === "PARTICULAR" && (
                        <>
                          <PaymentPartsReadOnly value={parts} />
                          <PaymentProofs
                            attachments={data.attachments}
                            billingRecordId={currentRow.record?.id}
                            readOnly
                          />
                        </>
                      )}
                      <label>
                        Valor recebido
                        <input
                          aria-label="Valor recebido"
                          readOnly
                          disabled
                          value={money(individualReceived(currentRow))}
                        />
                      </label>{" "}
                      {!appointmentId && (
                        <button
                          type="button"
                          className="billing-secondary"
                          onClick={() => editInvoice(currentRow.invoice!)}
                        >
                          Editar NF
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="billing-form-grid">
                        <label>
                          Entidade recebedora
                          <select
                            required
                            disabled={pendingContext}
                            value={String(draft.billing_entity_id || "")}
                            onChange={(e) =>
                              set("billing_entity_id", e.target.value)
                            }
                          >
                            <option value="">Selecione</option>
                            {options(allowedEntities)}
                          </select>
                        </label>
                        <label>
                          Forma de cobrança
                          <select
                            disabled={
                              pendingContext || !!currentRow.forma_cobranca
                            }
                            value={String(draft.billing_method)}
                            onChange={(e) =>
                              set("billing_method", e.target.value)
                            }
                          >
                            <option value="PARTICULAR">Particular</option>
                            <option value="CONVENIO">Convênio</option>
                          </select>
                        </label>
                        {field(
                          "received_amount",
                          "Valor recebido",
                          "number",
                          false,
                          !directPayment,
                        )}
                        {directPayment && (
                          <>
                            {field("paid_at", "Data de pagamento", "date")}
                            <label>
                              Status do pagamento
                              <select
                                value={String(draft.payment_status)}
                                onChange={(e) =>
                                  set("payment_status", e.target.value)
                                }
                              >
                                <option value="PENDENTE">Pendente</option>
                                <option value="PAGO">Pago</option>
                              </select>
                            </label>
                          </>
                        )}
                      </div>
                      {draft.billing_method === "PARTICULAR" &&
                        draft.payment_status === "PAGO" &&
                        data.requests?.some(
                          (r) =>
                            r.attendance_id === draft.attendance_id &&
                            r.status === "PENDING",
                        ) && (
                          <PaymentParts
                            value={parts}
                            onChange={setParts}
                            amount={safeAmount(draft.received_amount)}
                          />
                        )}{" "}
                      {draft.payment_status === "PAGO" && (
                        <PaymentProofs
                          attachments={data.attachments}
                          billingRecordId={
                            proofTarget?.billingRecordId ||
                            (currentRow.record?.payment_status === "PAGO"
                              ? currentRow.record.id
                              : undefined)
                          }
                          pendingFile={proofFile}
                          onPendingFileChange={setProofFile}
                          onChanged={() => void load()}
                        />
                      )}{" "}
                      {!allowedEntities.length && (
                        <p className="billing-error">
                          A gerência precisa cadastrar um vínculo entre médico e
                          entidade ativo.
                        </p>
                      )}
                      {draft.billing_method === "CONVENIO" &&
                        !directPayment && (
                          <p>
                            O valor individual, quando informado no item da NF,
                            será exibido aqui somente para leitura. Este
                            atendimento pode ser adicionado diretamente à NF
                            quando estiver realizado, sem preencher este
                            formulário.
                          </p>
                        )}
                      {(currentRow.legacy_payment ||
                        currentRow.legacy_invoice) &&
                        !currentRow.record && (
                          <p>
                            Registro anterior na agenda:{" "}
                            {money(currentRow.legacy_payment)} · NF{" "}
                            {currentRow.legacy_invoice || "—"}. Confira estes
                            dados ao preencher o financeiro.
                          </p>
                        )}
                      <label>
                        Observação
                        <textarea
                          value={String(draft.notes || "")}
                          onChange={(e) => set("notes", e.target.value)}
                        />
                      </label>
                    </>
                  )}
                </>
              )}
              {editing === "invoice" && (
                <>
                  <div className="billing-form-grid">
                    <label>
                      Tipo de tomador
                      <select
                        value="CONVENIO"
                        disabled={pendingContext || !!draft.id}
                        onChange={(e) => {
                          if (e.target.value === "PARTICULAR") {
                            setEditing("");
                            setPrivateInvoice(true);
                          }
                        }}
                      >
                        <option value="CONVENIO">Convênio</option>
                        <option value="PARTICULAR">Particular</option>
                      </select>
                    </label>
                    <label>
                      Empresa emissora
                      <select
                        required
                        disabled={pendingContext && !!draft.billing_entity_id}
                        value={String(draft.billing_entity_id || "")}
                        onChange={(e) => {
                          set("billing_entity_id", e.target.value);
                          setSelected([]);
                        }}
                      >
                        <option value="">Selecione</option>
                        {options(data.entities)}
                      </select>
                    </label>
                    <label>
                      Convênio
                      <select
                        required
                        disabled={pendingContext && !!draft.payer}
                        value={String(draft.payer || "")}
                        onChange={(e) => {
                          set("payer", e.target.value);
                          setSelected([]);
                        }}
                      >
                        <option value="">Selecione o pagador</option>
                        {payerOptions.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    {field("invoice_number", "Nº da NF", "text", true)}
                    {field("issue_date", "Data de emissão", "date", true)}
                    {field("paid_at", "Data de pagamento", "date")}
                    {field("total_amount", "Valor bruto", "number")}
                    {field("net_amount", "Valor líquido", "number")}
                  </div>
                  <label>
                    Observação
                    <textarea
                      value={String(draft.notes || "")}
                      onChange={(e) => set("notes", e.target.value)}
                    />
                  </label>
                  <h3>Atendimentos vinculados</h3>
                  <div className="billing-panel">
                    <table className="billing-table invoice-linked-table">
                      <thead>
                        <tr>
                          <th>Paciente</th>
                          <th>Data</th>
                          <th>Médico</th>
                          <th>Procedimento</th>
                          <th>Valor recebido</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {linkedRows.map((r) => (
                          <tr key={billingRowKey(r)}>
                            <td>{r.patient}</td>
                            <td>{date(r.date)}</td>
                            <td>{doctorName(r.doctor_id)}</td>
                            <td>{r.procedure}</td>
                            <td>{amountInput(r)}</td>
                            <td>
                              <button
                                className="billing-delete"
                                type="button"
                                aria-label={"Remover " + r.patient + " da NF"}
                                onClick={() =>
                                  setSelected((ids) =>
                                    ids.filter((id) => id !== r.attendance_id),
                                  )
                                }
                              >
                                <TrashIcon />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!selected.length && (
                      <p className="billing-empty">
                        Nenhum atendimento vinculado.
                      </p>
                    )}
                  </div>
                  <p>
                    Informe o valor de cada atendimento conforme o
                    demonstrativo. Não há rateio automático.
                  </p>
                  {cents(String(draft.closing_adjustment || 0)) !== 0 && (
                    <p className="billing-historical-note">
                      Ajuste de fechamento histórico:{" "}
                      {money(
                        cents(String(draft.closing_adjustment || 0)) / 100,
                      )}
                      {draft.closing_adjustment_reason
                        ? ` · ${String(draft.closing_adjustment_reason)}`
                        : ""}
                    </p>
                  )}
                  <p role="status">
                    Valor líquido: {money(safeAmount(draft.net_amount))} ·
                    Itens:{" "}
                    {money(
                      selected.reduce(
                        (n, id) => n + cents(safeAmount(amounts[id])),
                        0,
                      ) / 100,
                    )}{" "}
                    ·{" "}
                    {(() => {
                      const difference =
                        cents(safeAmount(draft.net_amount)) -
                        selected.reduce(
                          (n, id) => n + cents(safeAmount(amounts[id])),
                          0,
                        ) -
                        cents(String(draft.closing_adjustment || 0));
                      return difference === 0
                        ? "Valores conferidos"
                        : difference > 0
                          ? "Falta distribuir " + money(difference / 100)
                          : "Excede " + money(-difference / 100);
                    })()}
                  </p>
                  <PaymentParts
                    value={parts}
                    onChange={setParts}
                    amount={safeAmount(draft.net_amount)}
                  />
                  {draft.paid_at && (
                    <PaymentProofs
                      attachments={data.attachments}
                      invoiceId={
                        proofTarget?.invoiceId ||
                        (draft.id &&
                        data.invoices.find((i) => i.id === draft.id)?.paid_at
                          ? String(draft.id)
                          : undefined)
                      }
                      pendingFile={proofFile}
                      onPendingFileChange={setProofFile}
                      onChanged={() => void load()}
                    />
                  )}
                  <button
                    type="button"
                    className="billing-secondary"
                    disabled={!draft.billing_entity_id || !draft.payer}
                    onClick={openPicker}
                  >
                    + Adicionar atendimentos
                  </button>
                  {(!draft.billing_entity_id || !draft.payer) && (
                    <p>
                      Selecione a empresa e o pagador para adicionar
                      atendimentos.
                    </p>
                  )}
                </>
              )}

              {draft.id && (
                <p>
                  Cadastrado por: {userName(draft.created_by as number)} ·{" "}
                  {date(String(draft.created_at || ""))}
                  <br />
                  Última atualização por: {userName(
                    draft.updated_by as number,
                  )}{" "}
                  · {date(String(draft.updated_at || ""))}
                </p>
              )}
              {modalError && (
                <p role="alert" className="billing-error">
                  {modalError}
                </p>
              )}
              {proofTarget && proofFile && (
                <button
                  type="button"
                  className="billing-secondary"
                  disabled={busy}
                  onClick={() => void retryProof()}
                >
                  Tentar novamente
                </button>
              )}
              <div className="billing-modal-actions">
                <button
                  type="button"
                  disabled={busy}
                  className="billing-secondary"
                  onClick={() => setEditing("")}
                >
                  Fechar
                </button>
                {!(editing === "record" && currentRow?.invoice) && (
                  <button
                    disabled={busy}
                    className="billing-primary"
                    type="submit"
                  >
                    {busy ? "Salvando…" : "Salvar"}
                  </button>
                )}
              </div>
            </form>
          </AppDialog>
        )}
        {pickerOpen && (
          <AppDialog
            label="Adicionar atendimentos"
            onClose={() => setPickerOpen(false)}
          >
            <h2>Adicionar atendimentos</h2>
            <button
              type="button"
              className="billing-secondary"
              onClick={() => {
                setPickerOpen(false);
                setManual(true);
              }}
            >
              + Novo atendimento sem Agenda
            </button>
            <div className="billing-form-grid">
              <label>
                Buscar paciente
                <input
                  type="search"
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  placeholder="Nome do paciente"
                />
              </label>
              <label>
                Médico
                <select
                  value={pickerDoctor}
                  onChange={(e) => setPickerDoctor(e.target.value)}
                >
                  <option value="">Todos</option>
                  {options(
                    pickerDoctors.map((d) => ({ ...d, name: dr(d.name) })),
                  )}
                </select>
              </label>
            </div>
            <details className="invoice-advanced">
              <summary>Filtros avançados</summary>
              <div className="billing-form-grid">
                <label>
                  De
                  <input
                    type="date"
                    value={itemStart}
                    onChange={(e) => setItemStart(e.target.value)}
                  />
                </label>
                <label>
                  Até
                  <input
                    type="date"
                    value={itemEnd}
                    min={itemStart}
                    onChange={(e) => setItemEnd(e.target.value)}
                  />
                </label>
              </div>
            </details>
            <div className="billing-items">
              {nfCandidates.map((r) => (
                <div className="invoice-picker-row" key={r.attendance_id}>
                  <label className="billing-check">
                    <input
                      type="checkbox"
                      checked={pickerSelected.includes(r.attendance_id)}
                      onChange={(e) =>
                        setPickerSelected((ids) =>
                          e.target.checked
                            ? [...ids, r.attendance_id]
                            : ids.filter((id) => id !== r.attendance_id),
                        )
                      }
                    />
                    <span>
                      {r.patient} · {date(r.date)} · {doctorName(r.doctor_id)} ·{" "}
                      {r.procedure}
                    </span>
                  </label>
                  <label>
                    Valor por atendimento (obrigatório){amountInput(r)}
                  </label>
                </div>
              ))}
              {!nfCandidates.length && (
                <p>Nenhum atendimento elegível para esta empresa e pagador.</p>
              )}
            </div>
            <p>{pickerSelected.length} atendimento(s) selecionado(s).</p>
            <div className="billing-modal-actions">
              <button
                type="button"
                className="billing-secondary"
                onClick={() => setPickerOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="billing-primary"
                disabled={!pickerSelected.length}
                onClick={() => {
                  setSelected((ids) => [
                    ...new Set([...ids, ...pickerSelected]),
                  ]);
                  setPickerOpen(false);
                }}
              >
                Adicionar selecionados
              </button>
            </div>
          </AppDialog>
        )}
        {lifecycle && (
          <AppDialog
            label={lifecycle.label}
            onClose={() => setLifecycle(null)}
            busy={busy}
          >
            <h2>{lifecycle.label}</h2>
            <p>
              {lifecycle.kind === "undo_invoice"
                ? "O lançamento deixará de ser operacional. Pagamentos particulares serão preservados e a mesma solicitação será reaberta."
                : lifecycle.kind === "cancel_invoice"
                  ? "Confirme que o documento foi cancelado fiscalmente. O histórico permanecerá disponível."
                  : lifecycle.kind === "replace_invoice"
                    ? "Informe o motivo e preencha a nova NF. A substituição será salva em uma única operação."
                    : "O atendimento ficará cancelado no histórico e sairá das pendências ativas."}
            </p>
            <label>
              Motivo
              <textarea
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {modalError && <p role="alert">{modalError}</p>}
            <div className="billing-modal-actions">
              <button
                className="billing-secondary"
                disabled={busy}
                onClick={() => setLifecycle(null)}
              >
                Voltar
              </button>
              <button
                className="billing-danger"
                disabled={busy || !reason.trim()}
                onClick={() => void fiscalAction()}
              >
                {lifecycle.kind === "replace_invoice"
                  ? "Preencher substituta"
                  : "Confirmar"}
              </button>
            </div>
          </AppDialog>
        )}
        {confirmDelete && (
          <AppDialog
            label="Confirmar exclusão"
            compact
            onClose={() => setConfirmDelete(null)}
            busy={busy}
          >
            <h2>
              Excluir {confirmDelete.kind === "entity" ? "entidade" : "vínculo"}
              ?
            </h2>
            <p>{confirmDelete.name}</p>
            <p>
              {confirmDelete.kind === "entity"
                ? "A exclusão só será permitida se não houver vínculos ou histórico financeiro."
                : "Os faturamentos anteriores manterão a entidade recebedora registrada."}
            </p>
            {deleteError && (
              <p className="billing-error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="billing-modal-actions">
              <button
                className="billing-secondary"
                disabled={busy}
                onClick={() => setConfirmDelete(null)}
              >
                Cancelar
              </button>
              <button
                className="billing-danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy ? "Excluindo…" : "Excluir"}
              </button>
            </div>
          </AppDialog>
        )}
      </main>
    </>
  );
}
