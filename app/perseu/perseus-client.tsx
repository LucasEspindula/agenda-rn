"use client";

import { useCallback, useEffect, useState } from "react";
import BillingSubnav from "@/app/billing/billing-subnav";
import InsuranceControl from "@/app/billing/insurance-control";
import type { BillingData } from "@/lib/billing-types";
import { isInsurancePending } from "@/lib/billing-row";

const empty: BillingData = {
  payers: [],
  rows: [],
  entities: [],
  links: [],
  invoices: [],
  items: [],
  doctors: [],
};

export default function PerseusClient() {
  const [data, setData] = useState<BillingData>(empty),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/billing", { cache: "no-store" }),
        payload = await response.json();
      if (!response.ok)
        throw Error(
          payload.error || "Não foi possível carregar o workspace do Perseu.",
        );
      setData(payload as BillingData);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível carregar o workspace do Perseu.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const pendingCount = data.rows.filter(isInsurancePending).length;
  return (
    <>
      <BillingSubnav active="perseu" insurancePendingCount={pendingCount} />
      <main className="billing-main perseus-main">
        {loading ? (
          <p className="billing-empty">Carregando Perseu…</p>
        ) : error ? (
          <section className="perseus-load-error" role="alert">
            <p>{error}</p>
            <button
              className="billing-secondary"
              type="button"
              onClick={() => void load()}
            >
              Tentar novamente
            </button>
          </section>
        ) : (
          <InsuranceControl data={data} pendingCount={pendingCount} />
        )}
      </main>
    </>
  );
}
