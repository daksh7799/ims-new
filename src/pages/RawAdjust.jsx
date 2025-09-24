import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

// small helper
const today = () => new Date().toISOString().slice(0, 10);

export default function RawAdjust() {
  const [rows, setRows] = useState([]);            // recent raw_inward rows
  const [vendors, setVendors] = useState([]);      // [{id,name}]
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // edits stash keyed by inward id
  // { [id]: { qty, bill_no, vendor_id } }
  const [edits, setEdits] = useState({});

  // selection for PDF
  const [sel, setSel] = useState(new Set());
  const allSelected = useMemo(
    () => rows.length > 0 && rows.every(r => sel.has(r.id)),
    [rows, sel]
  );

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const [{ data: r, error: e1 }, { data: v, error: e2 }] = await Promise.all([
        supabase
          .from("raw_inward")
          .select(`
            id,
            raw_material_id,
            qty,
            purchase_date,
            bill_no,
            vendor_id,
            raw_materials ( name, unit ),
            vendors ( name )
          `)
          .order("id", { ascending: false })
          .limit(200),
        supabase.from("vendors").select("id,name").order("name"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      setRows(r || []);
      setVendors(v || []);

      // seed edits with current values
      const next = {};
      (r || []).forEach((x) => {
        next[x.id] = {
          qty: String(x.qty ?? ""),
          bill_no: String(x.bill_no ?? ""),
          vendor_id: String(x.vendor_id ?? ""),
        };
      });
      setEdits(next);
      setSel(new Set());
    } catch (e) {
      console.error(e);
      setErr(e.message || String(e));
      setRows([]);
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // realtime refresh if raw_inward rows are added/updated elsewhere
    const ch = supabase
      .channel("rt:raw_inward")
      .on("postgres_changes", { event: "*", schema: "public", table: "raw_inward" }, load)
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, []);

  function setEdit(id, patch) {
    setEdits((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  }

  function toggleOne(id, checked) {
    setSel((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAll(checked) {
    setSel(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }

  async function saveOne(r) {
    const e = edits[r.id] || {};
    const newQty = Number(e.qty);
    const sameQty = Number(r.qty) === newQty;
    const newVendor = e.vendor_id || null;
    const newBill = (e.bill_no || "").trim();

    if (!newBill) return alert("Bill number is required.");
    if (!newVendor) return alert("Vendor is required.");
    if (!Number.isFinite(newQty) || newQty <= 0) return alert("Quantity must be a positive number.");

    setSaving(true);
    try {
      // 1) If qty changed, call RPC to adjust (writes ledger correctly).
      if (!sameQty) {
        const { error: e1 } = await supabase.rpc("raw_inward_adjust", {
          p_inward_id: r.id,
          p_new_qty: newQty,
          p_note: `Edited on ${today()}`,
        });
        if (e1) throw e1;
      }

      // 2) Update header fields (vendor, bill_no). These don’t touch ledger.
      const { error: e2 } = await supabase
        .from("raw_inward")
        .update({ vendor_id: newVendor, bill_no: newBill })
        .eq("id", r.id);
      if (e2) throw e2;

      // refresh this row locally
      setRows((list) =>
        list.map((x) =>
          x.id === r.id
            ? {
                ...x,
                qty: newQty,
                bill_no: newBill,
                vendor_id: newVendor,
                vendors: { name: vendors.find((v) => String(v.id) === String(newVendor))?.name || x.vendors?.name },
              }
            : x
        )
      );
    } catch (error) {
      alert(`Save failed (id ${r.id}): ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveAll() {
    if (!rows.length) return;
    setSaving(true);
    try {
      for (const r of rows) {
        await saveOne(r);
      }
      alert("All visible rows saved.");
    } finally {
      setSaving(false);
    }
  }

  async function exportSelectedPDF() {
    if (sel.size === 0) {
      alert("Select at least one row to export.");
      return;
    }
    try {
      const { default: jsPDF } = await import("jspdf");
      await import("jspdf-autotable");

      const doc = new jsPDF();
      doc.setFontSize(14);
      doc.text("Raw Inward — Selected Entries", 14, 16);

      const body = rows
        .filter((r) => sel.has(r.id))
        .map((r) => [
          r.id,
          r.purchase_date,
          r.vendors?.name || "",
          r.bill_no || "",
          r.raw_materials?.name || "",
          r.qty,
          r.raw_materials?.unit || "",
        ]);

      // @ts-ignore
      doc.autoTable({
        startY: 22,
        head: [["ID", "Date", "Vendor", "Bill No.", "Raw Material", "Qty", "Unit"]],
        body,
        styles: { fontSize: 10 },
      });

      const fname = `raw_inward_selected_${today()}.pdf`;
      doc.save(fname);
    } catch (error) {
      alert(`PDF export failed: ${error.message || error}`);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Raw Inward — Adjust / Edit</b>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button className="btn" onClick={saveAll} disabled={saving || loading || rows.length === 0}>
              {saving ? "Saving…" : "Save All"}
            </button>
            <button className="btn outline" onClick={exportSelectedPDF} disabled={sel.size === 0}>
              Export Selected (PDF)
            </button>
          </div>
        </div>

        {!!err && <div className="bd"><div className="badge err">{err}</div></div>}

        <div className="bd" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </th>
                <th>ID</th>
                <th>Date</th>
                <th>Vendor</th>
                <th>Bill No.</th>
                <th>Raw Material</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th>Unit</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const e = edits[r.id] || {};
                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={sel.has(r.id)}
                        onChange={(ev) => toggleOne(r.id, ev.target.checked)}
                      />
                    </td>
                    <td>{r.id}</td>
                    <td>{r.purchase_date}</td>
                    <td>
                      <select
                        value={e.vendor_id ?? ""}
                        onChange={(ev) => setEdit(r.id, { vendor_id: ev.target.value })}
                        style={{ minWidth: 180 }}
                      >
                        <option value="">Select vendor…</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        placeholder="Bill number"
                        value={e.bill_no ?? ""}
                        onChange={(ev) => setEdit(r.id, { bill_no: ev.target.value })}
                        style={{ minWidth: 140 }}
                      />
                    </td>
                    <td>{r.raw_materials?.name}</td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        type="number"
                        step="0.00001"
                        min="0"
                        value={e.qty ?? ""}
                        onChange={(ev) => setEdit(r.id, { qty: ev.target.value })}
                        style={{ width: 120, textAlign: "right" }}
                        title="Changing qty will adjust stock via ledger"
                      />
                    </td>
                    <td>{r.raw_materials?.unit || "—"}</td>
                    <td>
                      <button className="btn ghost" onClick={() => saveOne(r)} disabled={saving}>
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ color: "var(--muted)" }}>
                    {loading ? "Loading…" : "No inward entries"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="s" style={{ color: "var(--muted)", marginTop: 6 }}>
          Notes:
          <ul style={{ margin: "6px 0 0 16px" }}>
            <li>Qty changes use <code>raw_inward_adjust(p_inward_id, p_new_qty, p_note)</code> to keep stock ledger correct.</li>
            <li>Vendor and Bill No. updates are saved directly on <code>raw_inward</code>.</li>
            <li>Use the checkboxes to export selected rows to a PDF (jsPDF + autoTable).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
