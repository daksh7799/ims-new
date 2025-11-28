// src/components/DailyStockCheck.jsx
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { useToast } from "../ui/toast.jsx";

// 🔥 CONFIG HERE — change this anytime
const ITEMS_PER_CHECK = 15;   // <---- change this number to ask 5 / 10 / 15 / 20 items

export default function DailyStockCheck({ onCompleted }) {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]); 
  const [submitted, setSubmitted] = useState(false);

  // Load N least recently checked active RMs
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("raw_materials")
          .select("id, name, unit, last_stock_check_date")
          .eq("is_active", true)
          .order("last_stock_check_date", { ascending: true, nullsFirst: true })
          .limit(ITEMS_PER_CHECK);  // <-- use dynamic variable

        if (error) throw error;
        if (!data || data.length === 0) {
          push("No active raw materials found", "warn");
          return;
        }

        const selected = data.map((rm) => ({
          ...rm,
          enteredQty: "",
        }));

        if (!cancelled) setItems(selected);
      } catch (e) {
        console.error(e);
        push(e.message, "err");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [push]);

  function updateQty(id, val) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, enteredQty: val } : item
      )
    );
  }

  // --- submit using RPC ---
  async function handleSubmit() {
    const invalid = items.find(
      (i) => i.enteredQty === "" || isNaN(Number(i.enteredQty))
    );
    if (invalid) {
      return push(`Please enter valid quantity for ${invalid.name}`, "warn");
    }

    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];

      const payload = items.map((i) => ({
        raw_material_id: i.id,
        measured_qty: Number(i.enteredQty),
        check_date: today,
      }));

      const { error } = await supabase.rpc(
        "upsert_daily_stock_checks_server",
        { p_checks: payload }
      );

      if (error) throw error;

      setSubmitted(true);
      push("Stock check submitted successfully!", "ok");

      if (onCompleted) onCompleted();
    } catch (e) {
      console.error(e);
      push(e.message || String(e), "err");
    } finally {
      setLoading(false);
    }
  }

  if (loading && items.length === 0) {
    return <div className="p-4">Loading stock check…</div>;
  }

  if (submitted) {
    return (
      <div className="card" style={{
        maxWidth: 600,
        margin: "40px auto",
        textAlign: "center",
        padding: 40,
      }}>
        <h2>✅ Stock Check Complete</h2>
        <p>Thank you for updating the stock.</p>
        <button className="btn outline" onClick={onCompleted}>
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="grid" style={{ maxWidth: 800, margin: "0 auto" }}>
      <div className="card">
        <div className="hd">
          <b>Daily Stock Check</b>
          <span className="badge">{ITEMS_PER_CHECK} Items (rotating)</span>
        </div>
        <div className="bd">
          <p style={{ marginBottom: 20, color: "var(--muted)" }}>
            Please physically check the stock for the following items and enter the quantity.
          </p>

          <table className="table">
            <thead>
              <tr>
                <th>Raw Material</th>
                <th style={{ width: 150 }}>Actual Qty</th>
                <th style={{ width: 60 }}>Unit</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={item.enteredQty}
                      onChange={(e) => updateQty(item.id, e.target.value)}
                      placeholder="0.00"
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: 20, justifyContent: "flex-end" }}>
            <button className="btn" onClick={handleSubmit} disabled={loading}>
              {loading ? "Saving..." : "Submit Stock Check"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
