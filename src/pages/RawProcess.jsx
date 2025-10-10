import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

export default function RawProcess() {
  const [pairs, setPairs] = useState([]);
  const [fallbackRms, setFallbackRms] = useState([]);
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false); // ✅ toggle for closed orders

  const [srcId, setSrcId] = useState("");
  const [outId, setOutId] = useState("");
  const [issueQty, setIssueQty] = useState("1");
  const [expQty, setExpQty] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  const [sel, setSel] = useState(null);
  const [recvQty, setRecvQty] = useState("");
  const [recvNote, setRecvNote] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [receipts, setReceipts] = useState([]);

  // ----- load data -----
  async function loadPairs() {
    const { data, error } = await supabase
      .from("v_processing_pairs_expanded")
      .select("*")
      .order("source_rm_name", { ascending: true })
      .order("output_rm_name", { ascending: true });
    if (error) {
      console.warn("v_processing_pairs_expanded error", error);
      setPairs([]);
    } else {
      setPairs(data || []);
    }
  }

  async function loadFallbackRMs() {
    const { data, error } = await supabase
      .from("raw_materials")
      .select("id,name")
      .eq("is_active", true)
      .order("name");
    if (error) {
      console.warn(error);
      setFallbackRms([]);
    } else setFallbackRms(data || []);
  }

  async function loadOrders() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("v_processing_orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadReceipts(orderId) {
    const { data, error } = await supabase
      .from("v_processing_receipts")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });
    if (error) {
      alert(error.message);
      return;
    }
    setReceipts(data || []);
  }

  useEffect(() => {
    (async () => {
      await Promise.all([loadPairs(), loadFallbackRMs(), loadOrders()]);
    })();
  }, []);

  // ✅ Filter list
  const filtered = useMemo(() => {
    const s = filter.trim().toLowerCase();
    return (orders || [])
      .filter((o) => showClosed || o.status !== "closed")
      .filter(
        (o) =>
          !s ||
          String(o.source_rm_name || "").toLowerCase().includes(s) ||
          String(o.output_rm_name || "").toLowerCase().includes(s) ||
          String(o.status || "").toLowerCase().includes(s) ||
          String(o.id || "").includes(s)
      );
  }, [orders, filter, showClosed]);

  // ----- derive sources -----
  const usingPairs = pairs.length > 0;
  const sources = useMemo(() => {
    if (!usingPairs) return fallbackRms;
    const map = new Map();
    for (const p of pairs) {
      map.set(String(p.source_rm_id), {
        id: String(p.source_rm_id),
        name: p.source_rm_name,
      });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [pairs, fallbackRms, usingPairs]);

  const outputsBySource = useMemo(() => {
    if (!usingPairs) return null;
    const m = new Map();
    for (const p of pairs) {
      const k = String(p.source_rm_id);
      const arr = m.get(k) || [];
      arr.push({ id: String(p.output_rm_id), name: p.output_rm_name });
      m.set(k, arr);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
      m.set(k, arr);
    }
    return m;
  }, [pairs, usingPairs]);

  useEffect(() => {
    if (!usingPairs) return;
    if (!srcId) {
      setOutId("");
      return;
    }
    const arr = outputsBySource?.get(String(srcId)) || [];
    if (arr.length === 1) {
      setOutId(arr[0].id);
    } else {
      if (!arr.some((x) => String(x.id) === String(outId))) setOutId("");
    }
  }, [srcId, usingPairs, outputsBySource]);

  // ----- create order -----
  async function createOrder() {
    const q = num(issueQty, 0);
    if (!srcId || !outId) {
      alert("Pick both Source and Output raw materials");
      return;
    }
    if (q <= 0) {
      alert("Issue qty must be > 0");
      return;
    }

    if (usingPairs) {
      const ok = pairs.some(
        (p) =>
          String(p.source_rm_id) === String(srcId) &&
          String(p.output_rm_id) === String(outId)
      );
      if (!ok) {
        alert("This source→output combination is not allowed.");
        return;
      }
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.rpc("create_processing_order", {
        p_source_rm_id: String(srcId),
        p_output_rm_id: String(outId),
        p_issue_qty: q,
        p_expected_output_qty: expQty ? num(expQty, 0) : null,
        p_note: note || null,
      });
      if (error) throw error;
      alert(`Processing order #${data} created`);
      setSrcId("");
      setOutId("");
      setIssueQty("1");
      setExpQty("");
      setNote("");
      await loadOrders();
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setCreating(false);
    }
  }

  // ----- receive -----
  async function receive() {
    if (!sel) {
      alert("Pick an order");
      return;
    }
    const q = num(recvQty, 0);
    if (q <= 0) {
      alert("Receipt qty must be > 0");
      return;
    }
    if (sel.status === "closed") {
      alert("Order is closed. Reopen before receiving.");
      return;
    }
    setReceiving(true);
    try {
      const { error } = await supabase.rpc("receive_processing", {
        p_order_id: sel.id,
        p_qty: q,
        p_note: recvNote || null,
      });
      if (error) throw error;
      setRecvQty("");
      setRecvNote("");
      await loadOrders();
      await loadReceipts(sel.id);
      const { data } = await supabase
        .from("v_processing_orders")
        .select("*")
        .eq("id", sel.id)
        .maybeSingle();
      setSel(data || null);
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setReceiving(false);
    }
  }

  // ----- close/reopen -----
  async function setClosed(closed) {
    if (!sel) return;

    const { error } = await supabase.rpc("processing_close", {
      p_order_id: sel.id,
      p_closed: !!closed,
    });

    if (error) {
      alert(error.message);
      return;
    }

    await loadOrders();

    if (closed) {
      // ✅ Auto-collapse when closed
      setSel(null);
      setReceipts([]);
    } else {
      // refresh if reopened
      const { data } = await supabase
        .from("v_processing_orders")
        .select("*")
        .eq("id", sel.id)
        .maybeSingle();
      setSel(data || null);
    }
  }

  // ----- UI -----
  return (
    <div className="grid">
      {/* Create order */}
      <div className="card">
        <div className="hd">
          <b>Create Processing Order</b>
        </div>
        <div className="bd" style={{ display: "grid", gap: 10 }}>
          <div
            className="row"
            style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}
          >
            <select
              value={srcId}
              onChange={(e) => setSrcId(e.target.value)}
              style={{ minWidth: 220 }}
            >
              <option value="">-- Source RM (out) --</option>
              {sources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            {!usingPairs ? (
              <select
                value={outId}
                onChange={(e) => setOutId(e.target.value)}
                style={{ minWidth: 220 }}
              >
                <option value="">-- Output RM (in) --</option>
                {fallbackRms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={outId}
                onChange={(e) => setOutId(e.target.value)}
                style={{ minWidth: 220 }}
                disabled={!srcId}
              >
                <option value="">-- Output RM (in) --</option>
                {(outputsBySource?.get(String(srcId)) || []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}

            <input
              type="number"
              min="0.0001"
              step="0.0001"
              placeholder="Issue qty"
              value={issueQty}
              onChange={(e) => setIssueQty(e.target.value)}
              style={{ width: 140 }}
            />
            <input
              type="number"
              min="0"
              step="0.0001"
              placeholder="Expected output (optional)"
              value={expQty}
              onChange={(e) => setExpQty(e.target.value)}
              style={{ width: 200 }}
            />
            <input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <button className="btn" onClick={createOrder} disabled={creating}>
              {creating ? "Creating…" : "Create & Issue"}
            </button>
          </div>
          <div className="s" style={{ color: "var(--muted)" }}>
            Issues <b>raw_out / adjust_out</b> of the Source RM. Receive outputs
            below in any number of batches (no cap). Close/reopen manually.
          </div>
        </div>
      </div>

      {/* Orders */}
      <div className="card">
        <div className="hd">
          <b>Processing Orders</b>
          <div className="row" style={{ gap: 8 }}>
            <input
              placeholder="Search (rm / status / id)…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
              />
              Show closed orders
            </label>
          </div>
        </div>

        <div className="bd" style={{ display: "grid", gap: 12 }}>
          <div style={{ overflow: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Source (OUT)</th>
                  <th style={{ textAlign: "right" }}>Issued</th>
                  <th>Output (IN)</th>
                  <th style={{ textAlign: "right" }}>Received</th>
                  <th style={{ textAlign: "right" }}>Remaining</th>
                  <th>Expected</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>{new Date(o.created_at).toLocaleString()}</td>
                    <td>
                      <span className="badge">{o.status}</span>
                    </td>
                    <td>{o.source_rm_name}</td>
                    <td style={{ textAlign: "right" }}>{o.issue_qty}</td>
                    <td>{o.output_rm_name}</td>
                    <td style={{ textAlign: "right" }}>{o.received_qty}</td>
                    <td
                      style={{
                        textAlign: "right",
                        color:
                          Number(o.remaining) < 0 ? "var(--error)" : undefined,
                      }}
                      title={
                        Number(o.remaining) < 0
                          ? "Received more than issued"
                          : undefined
                      }
                    >
                      {o.remaining}
                    </td>
                    <td>{o.expected_output_qty ?? "—"}</td>
                    <td>
                      <button
                        className="btn small"
                        onClick={() => {
                          if (sel?.id === o.id) {
                            setSel(null);
                            setReceipts([]);
                            return;
                          }
                          setSel(o);
                          loadReceipts(o.id);
                        }}
                      >
                        {sel?.id === o.id ? "Close" : "Select"}
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ color: "var(--muted)" }}>
                      No orders
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Receive Output Section */}
          {sel && (
            <div className="card" style={{ margin: 0 }}>
              <div className="hd">
                <b>Receive Output — Order #{sel.id}</b>
                <span className="badge">{sel.output_rm_name}</span>
                <div className="row" style={{ marginLeft: "auto", gap: 8 }}>
                  {sel.status === "open" ? (
                    <button
                      className="btn outline"
                      onClick={() => setClosed(true)}
                    >
                      Close Order
                    </button>
                  ) : (
                    <button
                      className="btn outline"
                      onClick={() => setClosed(false)}
                    >
                      Reopen Order
                    </button>
                  )}
                </div>
              </div>

              <div className="bd" style={{ display: "grid", gap: 8 }}>
                <div
                  className="row"
                  style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}
                >
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    placeholder="Receipt qty"
                    value={recvQty}
                    onChange={(e) => setRecvQty(e.target.value)}
                    style={{ width: 180 }}
                    title={`Issued: ${sel.issue_qty} | Received: ${sel.received_qty} | Remaining: ${sel.remaining}`}
                    disabled={sel.status === "closed"}
                  />
                  <input
                    placeholder="Note (optional)"
                    value={recvNote}
                    onChange={(e) => setRecvNote(e.target.value)}
                    style={{ minWidth: 240 }}
                    disabled={sel.status === "closed"}
                  />
                  <button
                    className="btn"
                    onClick={receive}
                    disabled={
                      receiving || num(recvQty) <= 0 || sel.status === "closed"
                    }
                    title={sel.status === "closed" ? "Order is closed" : ""}
                  >
                    {receiving ? "Receiving…" : "Receive"}
                  </button>
                </div>

                <div className="s" style={{ color: "var(--muted)" }}>
                  Free-form receiving: Remaining can be negative if you receive
                  more than issued. Close/reopen the order anytime.
                </div>

                <div style={{ overflow: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>When</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipts.map((r) => (
                        <tr key={r.id}>
                          <td>{r.id}</td>
                          <td>{new Date(r.created_at).toLocaleString()}</td>
                          <td style={{ textAlign: "right" }}>{r.qty}</td>
                          <td>{r.note || "—"}</td>
                        </tr>
                      ))}
                      {receipts.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ color: "var(--muted)" }}>
                            No receipts yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
