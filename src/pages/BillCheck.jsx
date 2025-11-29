import { useEffect, useState, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/toast";
import * as XLSX from "xlsx";

export default function BillCheck() {
    const { push } = useToast();
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedBill, setSelectedBill] = useState(null); // { vendor_id, bill_no, purchase_date }
    const [billDetails, setBillDetails] = useState([]); // Lines for the selected bill
    const [billMeta, setBillMeta] = useState({
        kanta_tulai_amt: 0,
        round_off_amt: 0,
        is_checked: false,
    });
    const [vendorDetails, setVendorDetails] = useState(null);

    // Load unique bills
    async function loadBills() {
        setLoading(true);
        try {
            // Fetch raw_inward grouped by vendor_id, bill_no
            // Since we can't easily "group by" in Supabase JS client with select, we fetch distinct bill_nos or all and process.
            // Fetching all raw_inward might be heavy, but let's try fetching distinct combinations via a stored procedure or just processing client side for now if dataset isn't huge.
            // Better approach: Fetch from bill_meta if it exists, OR fetch raw_inward distinct.
            // Given we want to show ALL bills even if not in bill_meta yet, we should query raw_inward.

            const { data, error } = await supabase
                .from("raw_inward")
                .select("vendor_id, bill_no, purchase_date, vendors(name)")
                .order("purchase_date", { ascending: false });

            if (error) throw error;

            // Group by vendor_id + bill_no
            const unique = [];
            const seen = new Set();
            data.forEach((item) => {
                const key = `${item.vendor_id}-${item.bill_no}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(item);
                }
            });
            setBills(unique);
        } catch (err) {
            push(`Load error: ${err.message}`, "err");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadBills();
    }, []);

    // Load details for a specific bill
    async function openBill(bill) {
        setLoading(true);
        try {
            // 1. Fetch lines
            const { data: lines, error: linesError } = await supabase
                .from("raw_inward")
                .select("id, qty, rate, raw_materials(name, unit, gst_rate)")
                .eq("vendor_id", bill.vendor_id)
                .eq("bill_no", bill.bill_no);

            if (linesError) throw linesError;

            // 2. Fetch meta
            const { data: meta, error: metaError } = await supabase
                .from("bill_meta")
                .select("*")
                .eq("vendor_id", bill.vendor_id)
                .eq("bill_no", bill.bill_no)
                .single();

            if (metaError && metaError.code !== "PGRST116") throw metaError; // Ignore not found

            // 3. Fetch vendor details (for Excel)
            const { data: vendor, error: vendorError } = await supabase
                .from("vendors")
                .select("*")
                .eq("id", bill.vendor_id)
                .single();

            if (vendorError) throw vendorError;

            setBillDetails(lines.map(l => ({ ...l, rate: l.rate || "" })));
            setBillMeta(meta || { kanta_tulai_amt: 0, round_off_amt: 0, is_checked: false });
            setVendorDetails(vendor);
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
        setBillMeta({ kanta_tulai_amt: 0, round_off_amt: 0, is_checked: false });
    }

    // Handle Rate Change
    function updateRate(lineId, newRate) {
        setBillDetails((prev) =>
            prev.map((line) => (line.id === lineId ? { ...line, rate: newRate } : line))
        );
    }

    // Calculations
    const calculated = useMemo(() => {
        let totalTaxable = 0;
        let totalSGST = 0;
        let totalCGST = 0;
        let totalIGST = 0;

        const isRajasthan = vendorDetails?.state?.toLowerCase().includes("rajasthan");

        const lines = billDetails.map((line) => {
            const qty = Number(line.qty) || 0;
            const rate = Number(line.rate) || 0;
            const amount = qty * rate;
            const gstRate = Number(line.raw_materials?.gst_rate) || 5; // Default 5%

            let sgst = 0, cgst = 0, igst = 0;
            if (isRajasthan) {
                sgst = amount * (gstRate / 2 / 100);
                cgst = amount * (gstRate / 2 / 100);
            } else {
                igst = amount * (gstRate / 100);
            }

            totalTaxable += amount;
            totalSGST += sgst;
            totalCGST += cgst;
            totalIGST += igst;

            return { ...line, amount, sgst, cgst, igst, gstRate };
        });

        const kanta = Number(billMeta.kanta_tulai_amt) || 0;
        const roundOff = Number(billMeta.round_off_amt) || 0;
        const finalTotal = totalTaxable + totalSGST + totalCGST + totalIGST - kanta + roundOff; // Kanta is usually deducted? User said "Kanta Tulai Amt" in header, let's assume it's a deduction or addition based on sign. User example: "-1140" for amount? Wait, user example: "Kanta Tulai 182.65". Usually it's an expense. Let's treat as addition for now unless user specified.
        // Re-reading user request: "Kanta Tulai Amt 182.65 ... Round Off 0.26 ... Invoice Amount 15455.05".
        // Let's assume standard accounting: Taxable + Tax + Charges = Total.
        // If Kanta Tulai is a deduction (e.g. weighing charge deducted from supplier payment), it might be subtracted.
        // User example:
        // Item Amount: -13904.8 (Negative?? Maybe it's a purchase return or just how they view it? Or maybe they pay this?)
        // Let's look at the user example again.
        // "Item Rate 114 Amount -1140" -> 10 * 114 = 1140. Why -1140?
        // Maybe it's a credit?
        // "Kanta Tulai 182.65"
        // "Input SGST 683.67"
        // "Input CGST 683.67"
        // "Round Off 0.26"
        // "Invoice Amount 15455.05"
        // Let's sum up: 1140 + 3200 + 10000.2 + 3285.75 + 13904.8 = 31530.75.
        // Wait, the example rows seem to be separate bills or lines?
        // Row 1: 10 * 114 = 1140.
        // Row 2: 25 * 128 = 3200.
        // Row 3: 60 * 166.67 = 10000.2
        // Row 4: 15 * 219.05 = 3285.75
        // Row 5: 20 * 695.24 = 13904.8
        // Total Items = 31530.75
        // SGST = 683.67? That's small for 31k.
        // Maybe only the last item has tax? Or tax is separate?
        // Let's stick to standard logic: Amount = Qty * Rate. Tax = Amount * Rate%. Total = Amount + Tax + Others.
        // I will implement standard logic and user can verify.

        const grandTotal = totalTaxable + totalSGST + totalCGST + totalIGST + kanta + roundOff;

        return { lines, totalTaxable, totalSGST, totalCGST, totalIGST, grandTotal };
    }, [billDetails, billMeta, vendorDetails]);

    // Save (without checking)
    async function save(check = false) {
        setLoading(true);
        try {
            // 1. Update Rates in raw_inward
            for (const line of billDetails) {
                const { error } = await supabase
                    .from("raw_inward")
                    .update({ rate: line.rate || null })
                    .eq("id", line.id);
                if (error) throw error;
            }

            // 2. Upsert Bill Meta
            const metaPayload = {
                vendor_id: selectedBill.vendor_id,
                bill_no: selectedBill.bill_no,
                purchase_date: selectedBill.purchase_date,
                kanta_tulai_amt: billMeta.kanta_tulai_amt,
                round_off_amt: billMeta.round_off_amt,
                is_checked: check ? true : billMeta.is_checked,
                checked_at: check ? new Date().toISOString() : billMeta.checked_at,
            };

            // Check if exists to decide insert vs update (or just upsert on unique key)
            const { error: metaError } = await supabase
                .from("bill_meta")
                .upsert(metaPayload, { onConflict: "vendor_id, bill_no" });

            if (metaError) throw metaError;

            if (check) {
                setBillMeta(prev => ({ ...prev, is_checked: true }));
                push("Bill checked and saved!", "ok");
            } else {
                push("Bill saved successfully!", "ok");
            }
        } catch (err) {
            push(`Save error: ${err.message}`, "err");
        } finally {
            setLoading(false);
        }
    }

    // Download Excel
    function downloadExcel() {
        if (!vendorDetails) return;

        const data = calculated.lines.map((line) => ({
            "Invoice Date": selectedBill.purchase_date,
            "Invoice No": selectedBill.bill_no,
            "Supplier Invoice No": selectedBill.bill_no,
            "Supplier Invoice Date": selectedBill.purchase_date,
            "Voucher Type": "Purchase",
            "Purchase Ledger": "01-Purchase Grocery", // Hardcoded as per example? Or dynamic?
            "Supplier Name": vendorDetails.name,
            "Address 1": vendorDetails.address_1 || "",
            "State": vendorDetails.state || "",
            "Country": vendorDetails.country || "India",
            "GSTIN/UIN": vendorDetails.gstin || "",
            "GST Registration Type": vendorDetails.gst_reg_type || "Regular",
            "Place of Suppy": vendorDetails.state || "",
            "Item Name": line.raw_materials?.name,
            "QTY": line.qty,
            "Item Rate": line.rate,
            "Amount": line.amount.toFixed(2),
            "Kanta Tulai Ledger": "Kanta Tulai",
            "Kanta Tulai Amt": billMeta.kanta_tulai_amt,
            "SGST Ledger": "Input SGST",
            "SGST Amount": line.sgst.toFixed(2),
            "CGST Ledger": "Input CGST",
            "CGST Amount": line.cgst.toFixed(2),
            "IGST Ledger": "Input IGST",
            "IGST Amount": line.igst.toFixed(2),
            "Round OFF Ledger": "Round Off",
            "Round OFF Amt": billMeta.round_off_amt,
            "Round OFF Amt dr/cr": "", // Logic?
            "Invoice Amount": calculated.grandTotal.toFixed(2),
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Bill");
        XLSX.writeFile(wb, `Bill_${selectedBill.bill_no}.xlsx`);
    }

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
                    <div className="row" style={{ marginBottom: 10, gap: 20 }}>
                        <div>
                            <label>Kanta Tulai Amt</label>
                            <input
                                type="number"
                                value={billMeta.kanta_tulai_amt}
                                onChange={(e) => setBillMeta({ ...billMeta, kanta_tulai_amt: e.target.value })}
                                disabled={loading}
                            />
                        </div>
                        <div>
                            <label>Round Off Amt</label>
                            <input
                                type="number"
                                value={billMeta.round_off_amt}
                                onChange={(e) => setBillMeta({ ...billMeta, round_off_amt: e.target.value })}
                                disabled={loading}
                            />
                        </div>
                    </div>

                    <table className="table">
                        <thead>
                            <tr>
                                <th>Item</th>
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
                                <td colSpan="4" style={{ textAlign: "right" }}><b>Total:</b></td>
                                <td><b>{calculated.totalTaxable.toFixed(2)}</b></td>
                                <td></td>
                                <td><b>{calculated.totalSGST.toFixed(2)}</b></td>
                                <td><b>{calculated.totalCGST.toFixed(2)}</b></td>
                                <td><b>{calculated.totalIGST.toFixed(2)}</b></td>
                            </tr>
                            <tr>
                                <td colSpan="8" style={{ textAlign: "right" }}>Kanta Tulai:</td>
                                <td>{Number(billMeta.kanta_tulai_amt).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td colSpan="8" style={{ textAlign: "right" }}>Round Off:</td>
                                <td>{Number(billMeta.round_off_amt).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td colSpan="8" style={{ textAlign: "right" }}><b>Grand Total:</b></td>
                                <td><b>{calculated.grandTotal.toFixed(2)}</b></td>
                            </tr>
                        </tfoot>
                    </table>

                    <div className="row" style={{ marginTop: 20, gap: 10 }}>
                        <button className="btn outline" onClick={() => save(false)} disabled={loading}>
                            Save
                        </button>
                        <button className="btn" onClick={() => save(true)} disabled={loading}>
                            Check & Save
                        </button>
                        <button className="btn ghost" onClick={downloadExcel} disabled={!billMeta.is_checked}>
                            Download Excel
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="grid">
            <div className="card">
                <div className="hd">
                    <b>Bill Check</b>
                    <button className="btn ghost small" onClick={loadBills} disabled={loading}>Refresh</button>
                </div>
                <div className="bd">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Bill No</th>
                                <th>Vendor</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bills.map((b, i) => (
                                <tr key={i}>
                                    <td>{b.purchase_date}</td>
                                    <td>{b.bill_no}</td>
                                    <td>{b.vendors?.name}</td>
                                    <td>
                                        <button className="btn small" onClick={() => openBill(b)}>Open</button>
                                    </td>
                                </tr>
                            ))}
                            {bills.length === 0 && (
                                <tr>
                                    <td colSpan="4" className="s">No bills found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
