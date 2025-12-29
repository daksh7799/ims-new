import { useEffect, useState, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/toast";
import * as XLSX from "xlsx";

export default function BillCheck() {
  const { push } = useToast();
  const [loading, setLoading] = useState(false);

  const [allBills, setAllBills] = useState([]);
  const [selectedBill, setSelectedBill] = useState(null);

  const [tab, setTab] = useState("pending");
  const [showUploaded, setShowUploaded] = useState(false);
  const [checkedSelection, setCheckedSelection] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const [billDetails, setBillDetails] = useState([]);
  const [vendorDetails, setVendorDetails] = useState(null);

  const [billMeta, setBillMeta] = useState({
    kanta_tulai_amt: 0,
    round_off_amt: 0,
    sgst_amt: 0,
    cgst_amt: 0,
    igst_amt: 0,
    is_checked: false,
  });

  const isRajasthan = useMemo(
    () => vendorDetails?.state?.toLowerCase().includes("rajasthan") ?? false,
    [vendorDetails?.state]
  );

  function calcTax({ qty, rate, gstRate, isRajasthan }) {
    const amount = +(qty * rate).toFixed(2);
    let sgst = 0,
      cgst = 0,
      igst = 0;

    if (isRajasthan) {
      sgst = +(amount * (gstRate / 2 / 100)).toFixed(2);
      cgst = sgst;
    } else {
      igst = +(amount * (gstRate / 100)).toFixed(2);
    }

    return { amount, sgst, cgst, igst };
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split("-");
    const months = [
      "Jan","Feb","Mar","Apr","May","Jun",
      "Jul","Aug","Sep","Oct","Nov","Dec"
    ];
    return `${day}-${months[parseInt(month) - 1]}-${year.slice(-2)}`;
  }

  // ------------ LOAD BILLS ------------
  async function loadBills() {
    setLoading(true);
    try {
      const { data: rawData, error: rawError } = await supabase
        .from("raw_inward")
        .select("vendor_id, bill_no, purchase_date, vendors(name)")
        .order("purchase_date", { ascending: false });

      if (rawError) throw rawError;

      const map = new Map();
      rawData.forEach((i) => {
        const name = i.vendors?.name?.toLowerCase() || "";
        if (name.includes("stock adjustment") || name.includes("mismatch")) return;

        const key = `${i.vendor_id}-${i.bill_no}`;
        if (!map.has(key)) map.set(key, { ...i, key });
      });

      const uniqueBills = Array.from(map.values());

      const { data: metaData } = await supabase
        .from("bill_meta")
        .select("vendor_id, bill_no, is_checked, uploaded_at");

      const metaMap = new Map();
      metaData?.forEach((m) => metaMap.set(`${m.vendor_id}-${m.bill_no}`, m));

      setAllBills(
        uniqueBills.map((b) => {
          const m = metaMap.get(b.key);
          return {
            ...b,
            is_checked: m?.is_checked || false,
            uploaded_at: m?.uploaded_at || null,
          };
        })
      );

      setCheckedSelection(new Set());
    } catch (err) {
      push(`Load error: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBills();
  }, []);

  const pendingBills = allBills.filter((b) => !b.is_checked);

  const checkedBills = allBills.filter((b) => {
    if (!b.is_checked) return false;
    if (!showUploaded && b.uploaded_at) return false;
    if (searchQuery && !b.bill_no.toLowerCase().includes(searchQuery.toLowerCase()))
      return false;
    return true;
  });

  // ------------ OPEN BILL ------------
  async function openBill(bill) {
    setLoading(true);
    try {
      const [linesRes, metaRes, vendorRes] = await Promise.all([
        supabase
          .from("raw_inward")
          .select(
            "id, qty, rate, raw_material_id, raw_materials(id, name, unit, gst_rate, accounting_name)"
          )
          .eq("vendor_id", bill.vendor_id)
          .eq("bill_no", bill.bill_no),

        supabase
          .from("bill_meta")
          .select("*")
          .eq("vendor_id", bill.vendor_id)
          .eq("bill_no", bill.bill_no)
          .maybeSingle(),

        supabase
          .from("vendors")
          .select("*")
          .eq("id", bill.vendor_id)
          .single(),
      ]);

      const lines = linesRes.data || [];
      const meta = metaRes.data;
      const vendor = vendorRes.data;

      const materialIds = lines.map((l) => l.raw_material_id);

      const { data: historyRates } = await supabase
        .from("raw_inward")
        .select("raw_material_id, rate, purchase_date")
        .in("raw_material_id", materialIds)
        .not("rate", "is", null)
        .gt("rate", 0)
        .lte("purchase_date", bill.purchase_date)
        .order("purchase_date", { ascending: false });

      const rateMap = new Map();
      historyRates?.forEach((r) => {
        if (!rateMap.has(r.raw_material_id))
          rateMap.set(r.raw_material_id, r.rate);
      });

      setBillDetails(
        lines.map((l) => ({
          ...l,
          rate: Number(l.rate) || rateMap.get(l.raw_material_id) || 0,
        }))
      );

      setVendorDetails(vendor);

      setBillMeta({
        kanta_tulai_amt: meta?.kanta_tulai_amt || 0,
        round_off_amt: meta?.round_off_amt || 0,
        sgst_amt: meta?.sgst_amt || 0,
        cgst_amt: meta?.cgst_amt || 0,
        igst_amt: meta?.igst_amt || 0,
        is_checked: meta?.is_checked || false,
      });

      setSelectedBill(bill);
    } catch (err) {
      push(`Open error: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  function closeBill() {
    setSelectedBill(null);
    setBillDetails([]);
    setBillMeta({
      kanta_tulai_amt: 0,
      round_off_amt: 0,
      sgst_amt: 0,
      cgst_amt: 0,
      igst_amt: 0,
      is_checked: false,
    });
    loadBills();
  }

  function updateRate(id, value) {
    setBillDetails((prev) =>
      prev.map((l) => (l.id === id ? { ...l, rate: value } : l))
    );
  }

  // ------------ CALC ------------
  const calculated = useMemo(() => {
    let totals = { taxable: 0, sgst: 0, cgst: 0, igst: 0, qty: 0 };

    const lines = billDetails.map((line) => {
      const qty = Number(line.qty) || 0;
      const rate = Number(line.rate) || 0;
      const gstRate = Number(line.raw_materials?.gst_rate ?? 5);

      const res = calcTax({ qty, rate, gstRate, isRajasthan });

      totals.taxable += res.amount;
      totals.sgst += res.sgst;
      totals.cgst += res.cgst;
      totals.igst += res.igst;
      totals.qty += qty;

      return { ...line, gstRate, ...res };
    });

    return {
      lines,
      totalTaxable: totals.taxable,
      totalSGST: totals.sgst,
      totalCGST: totals.cgst,
      totalIGST: totals.igst,
      totalQty: totals.qty,
    };
  }, [billDetails, isRajasthan]);

  useEffect(() => {
    if (!selectedBill) return;

    setBillMeta((prev) => ({
      ...prev,
      sgst_amt: calculated.totalSGST,
      cgst_amt: calculated.totalCGST,
      igst_amt: calculated.totalIGST,
    }));
  }, [
    selectedBill,
    calculated.totalSGST,
    calculated.totalCGST,
    calculated.totalIGST,
  ]);

  const grandTotal =
    calculated.totalTaxable +
    Number(billMeta.sgst_amt) +
    Number(billMeta.cgst_amt) +
    Number(billMeta.igst_amt) +
    Number(billMeta.kanta_tulai_amt) +
    Number(billMeta.round_off_amt);

  // ------------ SAVE (FIXED) ------------
  async function save(check = false) {
    setLoading(true);
    try {
      await Promise.all(
        billDetails.map((l) =>
          supabase
            .from("raw_inward")
            .update({
              rate: Number(l.rate) || 0,
            })
            .eq("id", l.id)
        )
      );

      const payload = {
        vendor_id: selectedBill.vendor_id,
        bill_no: selectedBill.bill_no,
        purchase_date: selectedBill.purchase_date,
        kanta_tulai_amt: billMeta.kanta_tulai_amt,
        round_off_amt: billMeta.round_off_amt,
        sgst_amt: billMeta.sgst_amt,
        cgst_amt: billMeta.cgst_amt,
        igst_amt: billMeta.igst_amt,
        is_checked: check ? true : billMeta.is_checked,
        checked_at: check ? new Date().toISOString() : billMeta.checked_at,
      };

      await supabase
        .from("bill_meta")
        .upsert(payload, { onConflict: "vendor_id, bill_no" });

      push(check ? "Bill checked and saved!" : "Bill saved successfully!", "ok");
    } catch (err) {
      push(`Save error: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  // ------------ DOWNLOAD ------------
  async function downloadSelected() {
    if (checkedSelection.size === 0) return;

    setLoading(true);
    try {
      const billsToProcess = checkedBills.filter((b) =>
        checkedSelection.has(b.key)
      );

      const allRows = [];

      for (const bill of billsToProcess) {
        const { data: lines } = await supabase
          .from("raw_inward")
          .select("qty, rate, raw_materials(name, accounting_name, gst_rate)")
          .eq("vendor_id", bill.vendor_id)
          .eq("bill_no", bill.bill_no);

        const { data: meta } = await supabase
          .from("bill_meta")
          .select("*")
          .eq("vendor_id", bill.vendor_id)
          .eq("bill_no", bill.bill_no)
          .single();

        const { data: vendor } = await supabase
          .from("vendors")
          .select("*")
          .eq("id", bill.vendor_id)
          .single();

        if (!lines || !meta || !vendor) continue;

        let totalTaxable = 0;

        const processed = lines.map((l) => {
          const qty = Number(l.qty) || 0;
          const rate = Number(l.rate) || 0;

          const t = calcTax({
            qty,
            rate,
            gstRate: Number(l.raw_materials?.gst_rate ?? 5),
            isRajasthan,
          });

          totalTaxable += t.amount;
          return { ...l, ...t };
        });

        const grand =
          totalTaxable +
          Number(meta.sgst_amt) +
          Number(meta.cgst_amt) +
          Number(meta.igst_amt) +
          Number(meta.kanta_tulai_amt) +
          Number(meta.round_off_amt);

        processed.forEach((line, index) => {
          const isLast = index === processed.length - 1;
          const isFirst = index === 0;

          const roundVal = Number(meta.round_off_amt);

          allRows.push({
            "Invoice Date": formatDate(bill.purchase_date),
            "Invoice No": bill.bill_no,
            "Supplier Invoice No": bill.bill_no,
            "Supplier Invoice Date": formatDate(bill.purchase_date),
            "Voucher Type": "Purchase",
            "Purchase Ledger": "01-Purchase Grocery",

            "Supplier Name": isFirst ? vendor.name : "",
            "Address 1": isFirst ? (vendor.address_1 || "") : "",
            "State": isFirst ? (vendor.state || "") : "",
            "Country": isFirst ? (vendor.country || "India") : "",
            "GSTIN/UIN": isFirst ? (vendor.gstin || "") : "",
            "GST Registration Type": isFirst ? (vendor.gst_reg_type || "Regular") : "",
            "Place of Suppy": isFirst ? (vendor.state || "") : "",

            "Item Name":
              line.raw_materials?.accounting_name ||
              line.raw_materials?.name,
            QTY: line.qty,
            "Item Rate": line.rate,
            Amount: (line.amount * -1).toFixed(2),

            "Kanta Tulai Ledger": isLast ? "Kanta Tulai" : "",
            "Kanta Tulai Amt": isLast ? meta.kanta_tulai_amt : "",

            "SGST Ledger": isLast ? "Input SGST" : "",
            "SGST Amount": isLast ? Number(meta.sgst_amt).toFixed(2) : "",

            "CGST Ledger": isLast ? "Input CGST" : "",
            "CGST Amount": isLast ? Number(meta.cgst_amt).toFixed(2) : "",

            "IGST Ledger": isLast ? "Input IGST" : "",
            "IGST Amount": isLast ? Number(meta.igst_amt).toFixed(2) : "",

            "Round OFF Ledger": isLast ? "Round Off" : "",
            "Round OFF Amt": isLast
              ? Math.abs(roundVal).toFixed(2)
              : "",
            "Round OFF Amt dr/cr": isLast
              ? (roundVal < 0 ? "Cr" : "Dr")
              : "",

            "Invoice Amount": isLast ? grand.toFixed(2) : "",
          });
        });
      }

      const ws = XLSX.utils.json_to_sheet(allRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bills");
      XLSX.writeFile(
        wb,
        `Bills_Export_${new Date().toISOString().slice(0, 10)}.xlsx`
      );

      const now = new Date().toISOString();

      await supabase
        .from("bill_meta")
        .update({ uploaded_at: now })
        .in("bill_no", billsToProcess.map((b) => b.bill_no))
        .in("vendor_id", billsToProcess.map((b) => b.vendor_id));

      push(`Downloaded ${billsToProcess.length} bills.`, "ok");
      loadBills();
    } catch (err) {
      push(`Download error: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  // ------------ RENDER ------------
  if (selectedBill) {
    return (
      <div className="card">
        <div className="hd">
          <button className="btn ghost small" onClick={closeBill}>← Back</button>
          <b>Bill: {selectedBill.bill_no}</b>
          <span className="badge">{selectedBill.vendors?.name}</span>
          <span className="badge">{selectedBill.purchase_date}</span>
          {billMeta.is_checked && <span className="badge green">Checked</span>}
        </div>

        <div className="bd">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Acc. Name</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>GST %</th>
                <th>SGST</th>
                <th>CGST</th>
                <th>IGST</th>
              </tr>
            </thead>

            <tbody>
              {calculated.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.raw_materials?.name}</td>
                  <td>
                    <small style={{ color: "var(--muted)" }}>
                      {line.raw_materials?.accounting_name || "-"}
                    </small>
                  </td>
                  <td>{line.qty}</td>
                  <td>{line.raw_materials?.unit}</td>
                  <td>
                    <input
                      type="number"
                      value={line.rate}
                      onChange={(e) => updateRate(line.id, e.target.value)}
                      style={{ width: 100 }}
                      disabled={loading}
                    />
                  </td>
                  <td>{line.amount.toFixed(2)}</td>
                  <td>{line.gstRate}%</td>
                  <td>{line.sgst.toFixed(2)}</td>
                  <td>{line.cgst.toFixed(2)}</td>
                  <td>{line.igst.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan="2" style={{ textAlign: "right" }}><b>Total:</b></td>
                <td><b>{calculated.totalQty}</b></td>
                <td colSpan="2"></td>
                <td><b>{calculated.totalTaxable.toFixed(2)}</b></td>
                <td></td>
                <td>{calculated.totalSGST.toFixed(2)}</td>
                <td>{calculated.totalCGST.toFixed(2)}</td>
                <td>{calculated.totalIGST.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ maxWidth: 400, marginLeft: "auto", marginTop: 20 }}>
            <div className="row" style={{ marginBottom: 5 }}>
              <label>Total Taxable:</label>
              <span>{calculated.totalTaxable.toFixed(2)}</span>
            </div>

            <div className="row" style={{ marginBottom: 5 }}>
              <label>Total SGST:</label>
              <input
                type="number"
                value={billMeta.sgst_amt}
                onChange={(e) => setBillMeta({ ...billMeta, sgst_amt: e.target.value })}
                style={{ width: 120, textAlign: "right" }}
              />
            </div>

            <div className="row" style={{ marginBottom: 5 }}>
              <label>Total CGST:</label>
              <input
                type="number"
                value={billMeta.cgst_amt}
                onChange={(e) => setBillMeta({ ...billMeta, cgst_amt: e.target.value })}
                style={{ width: 120, textAlign: "right" }}
              />
            </div>

            <div className="row" style={{ marginBottom: 5 }}>
              <label>Total IGST:</label>
              <input
                type="number"
                value={billMeta.igst_amt}
                onChange={(e) => setBillMeta({ ...billMeta, igst_amt: e.target.value })}
                style={{ width: 120, textAlign: "right" }}
              />
            </div>

            <div className="row" style={{ marginBottom: 5 }}>
              <label>Kanta Tulai:</label>
              <input
                type="number"
                value={billMeta.kanta_tulai_amt}
                onChange={(e) => setBillMeta({ ...billMeta, kanta_tulai_amt: e.target.value })}
                style={{ width: 120, textAlign: "right" }}
              />
            </div>

            <div className="row" style={{ marginBottom: 5 }}>
              <label>Round Off:</label>
              <input
                type="number"
                value={billMeta.round_off_amt}
                onChange={(e) => setBillMeta({ ...billMeta, round_off_amt: e.target.value })}
                style={{ width: 120, textAlign: "right" }}
              />
            </div>

            <div className="row" style={{ marginTop: 10, borderTop: "1px solid #ccc", paddingTop: 10 }}>
              <b>Grand Total:</b>
              <b>{grandTotal.toFixed(2)}</b>
            </div>
          </div>

          <div className="row" style={{ marginTop: 20, gap: 10, justifyContent: "flex-end" }}>
            <button className="btn outline" onClick={() => save(false)} disabled={loading}>
              Save
            </button>
            <button className="btn" onClick={() => save(true)} disabled={loading}>
              Check & Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ------------ LIST MODE ------------
  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Bill Check</b>

          <div className="row" style={{ gap: 10 }}>
            <button
              className={`btn small ${tab === "pending" ? "" : "outline"}`}
              onClick={() => setTab("pending")}
            >
              Pending
            </button>

            <button
              className={`btn small ${tab === "checked" ? "" : "outline"}`}
              onClick={() => setTab("checked")}
            >
              Checked
            </button>

            <button className="btn ghost small" onClick={loadBills} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>

        <div className="bd">
          {tab === "checked" && (
            <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <label>
                  <input
                    type="checkbox"
                    checked={showUploaded}
                    onChange={(e) => setShowUploaded(e.target.checked)}
                  />{" "}
                  Show Uploaded
                </label>

                <input
                  placeholder="Search Bill No..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ width: 150 }}
                />

                <span className="badge">{checkedBills.length} bills</span>
              </div>

              <button
                className="btn"
                onClick={downloadSelected}
                disabled={checkedSelection.size === 0 || loading}
              >
                Download Selected ({checkedSelection.size})
              </button>
            </div>
          )}

          <table className="table">
            <thead>
              <tr>
                {tab === "checked" && (
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={
                        checkedBills.length > 0 &&
                        checkedSelection.size === checkedBills.length
                      }
                      onChange={() => {
                        if (checkedSelection.size === checkedBills.length)
                          setCheckedSelection(new Set());
                        else
                          setCheckedSelection(new Set(checkedBills.map((b) => b.key)));
                      }}
                    />
                  </th>
                )}
                <th>Date</th>
                <th>Bill No</th>
                <th>Vendor</th>
                {tab === "checked" && <th>Status</th>}
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {(tab === "pending" ? pendingBills : checkedBills).map((b) => (
                <tr key={b.key}>
                  {tab === "checked" && (
                    <td>
                      <input
                        type="checkbox"
                        checked={checkedSelection.has(b.key)}
                        onChange={() => {
                          const next = new Set(checkedSelection);
                          if (next.has(b.key)) next.delete(b.key);
                          else next.add(b.key);
                          setCheckedSelection(next);
                        }}
                      />
                    </td>
                  )}

                  <td>{b.purchase_date}</td>
                  <td>{b.bill_no}</td>
                  <td>{b.vendors?.name}</td>

                  {tab === "checked" && (
                    <td>
                      {b.is_checked && <span className="badge green">Checked</span>}
                      {b.uploaded_at && <span className="badge blue">Uploaded</span>}
                    </td>
                  )}

                  <td>
                    <button className="btn small" onClick={() => openBill(b)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}

              {(tab === "pending" ? pendingBills : checkedBills).length === 0 && (
                <tr>
                  <td colSpan={tab === "checked" ? "6" : "4"} className="s">
                    No bills found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
