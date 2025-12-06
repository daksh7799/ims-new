import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/toast";
import * as XLSX from "xlsx";

export default function BillCheck() {
    const { push } = useToast();
    const [loading, setLoading] = useState(false);

    // Data
    const [allBills, setAllBills] = useState([]); // All unique bills with meta info
    const [selectedBill, setSelectedBill] = useState(null); // Currently open bill for editing

    // Tabs & Filters
    const [tab, setTab] = useState('pending'); // 'pending' | 'checked'
    const [showUploaded, setShowUploaded] = useState(false);
    const [checkedSelection, setCheckedSelection] = useState(new Set()); // Set of "vendor_id-bill_no"

    // Bill Details (for editing)
    const [billDetails, setBillDetails] = useState([]);
    const [billMeta, setBillMeta] = useState({
        kanta_tulai_amt: 0,
        round_off_amt: 0,
        sgst_amt: 0,
        cgst_amt: 0,
        igst_amt: 0,
        is_checked: false,
    });
    const [vendorDetails, setVendorDetails] = useState(null);

    // Load unique bills and their meta status
    async function loadBills() {
        setLoading(true);
        try {
            // 1. Fetch raw_inward distinct bills
            const { data: rawData, error: rawError } = await supabase
                .from("raw_inward")
                .select("vendor_id, bill_no, purchase_date, vendors(name)")
                .order("purchase_date", { ascending: false });

            if (rawError) throw rawError;

            // Group by vendor_id + bill_no to get unique bills
            const uniqueMap = new Map();
            rawData.forEach((item) => {
                const vendorName = item.vendors?.name || "";
                // Filter out excluded vendors
                if (vendorName.toLowerCase().includes("stock adjustment") || vendorName.toLowerCase().includes("mismatch")) {
                    return;
                }

                const key = `${item.vendor_id}-${item.bill_no}`;
                if (!uniqueMap.has(key)) {
                    uniqueMap.set(key, { ...item, key });
                }
            });

            const uniqueBills = Array.from(uniqueMap.values());

            // 2. Fetch bill_meta for these bills to get status
            // We can't easily join in the first query because raw_inward is line items.
            // We'll fetch all bill_meta or just for these vendors? Fetching all is likely fine for now.
            const { data: metaData, error: metaError } = await supabase
                .from("bill_meta")
                .select("vendor_id, bill_no, is_checked, uploaded_at");

            if (metaError) throw metaError;

            // Map meta to bills
            const metaMap = new Map();
            metaData.forEach(m => {
                metaMap.set(`${m.vendor_id}-${m.bill_no}`, m);
            });

            const merged = uniqueBills.map(b => {
                const m = metaMap.get(b.key);
                return {
                    ...b,
                    is_checked: m?.is_checked || false,
                    uploaded_at: m?.uploaded_at || null
                };
            });

            setAllBills(merged);
            setCheckedSelection(new Set()); // Reset selection on reload
        } catch (err) {
            push(`Load error: ${err.message}`, "err");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadBills();
    }, []);

    const [searchQuery, setSearchQuery] = useState("");

    // Filtered lists
    const pendingBills = allBills.filter(b => !b.is_checked);
    const checkedBills = allBills.filter(b => {
        if (!b.is_checked) return false;
        if (!showUploaded && b.uploaded_at) return false;
        if (searchQuery && !b.bill_no.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    // --- Selection Logic for Checked Tab ---
    function toggleSelection(key) {
        const next = new Set(checkedSelection);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setCheckedSelection(next);
    }

    function toggleAllChecked() {
        if (checkedSelection.size === checkedBills.length) {
            setCheckedSelection(new Set());
        } else {
            setCheckedSelection(new Set(checkedBills.map(b => b.key)));
        }
    }

    // --- Open Bill for Editing ---
    async function openBill(bill) {
        setLoading(true);
        try {
            // 1. Fetch lines
            const { data: lines, error: linesError } = await supabase
                .from("raw_inward")
                .select("id, qty, rate, raw_material_id, raw_materials(id, name, unit, gst_rate, accounting_name)")
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

            if (metaError && metaError.code !== "PGRST116") throw metaError;

            // 3. Fetch vendor details
            const { data: vendor, error: vendorError } = await supabase
                .from("vendors")
                .select("*")
                .eq("id", bill.vendor_id)
                .single();

            if (vendorError) throw vendorError;

            // 4. Auto-fill latest rates for missing ones
            const linesWithRates = await Promise.all(lines.map(async (l) => {
                if (l.rate) return l; // Already has rate

                // Fetch latest rate for this material
                const { data: latest } = await supabase
                    .from("raw_inward")
                    .select("rate")
                    .eq("raw_material_id", l.raw_material_id) // Assuming raw_materials relation returns id? Wait, select above didn't fetch raw_material_id explicitly but it might be in 'raw_inward' columns. 
                    // The select was "id, qty, rate, raw_materials(name...)"
                    // I need to make sure I have raw_material_id. 
                    // Let's check the select query in step 1.
                    // It is: .select("id, qty, rate, raw_materials(name, unit, gst_rate, accounting_name)")
                    // It does NOT explicitly select raw_material_id. I should add it.
                    .neq("rate", null)
                    .lte("purchase_date", bill.purchase_date)
                    .order("purchase_date", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                return { ...l, rate: latest?.rate || "" };
            }));

            setBillDetails(linesWithRates);
            setVendorDetails(vendor);

            if (meta) {
                setBillMeta({
                    kanta_tulai_amt: meta.kanta_tulai_amt || 0,
                    round_off_amt: meta.round_off_amt || 0,
                    sgst_amt: meta.sgst_amt || 0,
                    cgst_amt: meta.cgst_amt || 0,
                    igst_amt: meta.igst_amt || 0,
                    is_checked: meta.is_checked || false,
                });
            } else {
                setBillMeta({
                    kanta_tulai_amt: 0,
                    round_off_amt: 0,
                    sgst_amt: 0,
                    cgst_amt: 0,
                    igst_amt: 0,
                    is_checked: false,
                });
            }

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
        setBillMeta({ kanta_tulai_amt: 0, round_off_amt: 0, sgst_amt: 0, cgst_amt: 0, igst_amt: 0, is_checked: false });
        loadBills(); // Refresh list to update status if changed
    }

    // --- Editing Logic ---
    function updateRate(lineId, newRate) {
        setBillDetails((prev) =>
            prev.map((line) => (line.id === lineId ? { ...line, rate: newRate } : line))
        );
    }

    const calculated = useMemo(() => {
        let totalTaxable = 0;
        let totalSGST = 0;
        let totalCGST = 0;
        let totalIGST = 0;
        let totalQty = 0;

        const isRajasthan = vendorDetails?.state?.toLowerCase().includes("rajasthan");

        const lines = billDetails.map((line) => {
            const qty = Number(line.qty) || 0;
            const rate = Number(line.rate) || 0;
            const amount = Math.round((qty * rate) * 100) / 100; // Round to 2 decimal places
            const gstRate = line.raw_materials?.gst_rate != null ? Number(line.raw_materials.gst_rate) : 5;

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
            totalQty += qty;

            return { ...line, amount, sgst, cgst, igst, gstRate };
        });

        return { lines, totalTaxable, totalSGST, totalCGST, totalIGST, totalQty };
    }, [billDetails, vendorDetails]);

    const isInitialLoad = useRef(true);

    useEffect(() => {
        if (!selectedBill) return;

        // Skip the first auto-calculation after opening to preserve saved values
        if (isInitialLoad.current) {
            isInitialLoad.current = false;
            return;
        }

        setBillMeta(prev => ({
            ...prev,
            sgst_amt: calculated.totalSGST,
            cgst_amt: calculated.totalCGST,
            igst_amt: calculated.totalIGST,
        }));
    }, [calculated.totalSGST, calculated.totalCGST, calculated.totalIGST, selectedBill]);

    const grandTotal =
        calculated.totalTaxable +
        Number(billMeta.sgst_amt || 0) +
        Number(billMeta.cgst_amt || 0) +
        Number(billMeta.igst_amt || 0) +
        Number(billMeta.kanta_tulai_amt || 0) +
        Number(billMeta.round_off_amt || 0);

    async function save(check = false) {
        setLoading(true);
        try {
            for (const line of billDetails) {
                const { error } = await supabase
                    .from("raw_inward")
                    .update({ rate: line.rate || null })
                    .eq("id", line.id);
                if (error) throw error;
            }

            const metaPayload = {
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

    // Helper for date formatting: YYYY-MM-DD -> DD-MMM-YY
    function formatDate(dateStr) {
        if (!dateStr) return "";
        const [year, month, day] = dateStr.split('-');
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const m = months[parseInt(month) - 1];
        const y = year.slice(-2);
        return `${day}-${m}-${y}`;
    }

    // --- Bulk Download Logic ---
    async function downloadSelected() {
        if (checkedSelection.size === 0) return;
        setLoading(true);
        try {
            const allRows = [];
            const billsToProcess = checkedBills.filter(b => checkedSelection.has(b.key));

            for (const bill of billsToProcess) {
                // Fetch details for this bill
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

                // Calculate totals for this bill
                let totalTaxable = 0;
                const isRajasthan = vendor.state?.toLowerCase().includes("rajasthan");

                const processedLines = lines.map(line => {
                    const qty = Number(line.qty) || 0;
                    const rate = Number(line.rate) || 0;
                    const amount = Math.round((qty * rate) * 100) / 100; // Round to 2 decimal places
                    const gstRate = line.raw_materials?.gst_rate != null ? Number(line.raw_materials.gst_rate) : 5;

                    let sgst = 0, cgst = 0, igst = 0;
                    if (isRajasthan) {
                        sgst = amount * (gstRate / 2 / 100);
                        cgst = amount * (gstRate / 2 / 100);
                    } else {
                        igst = amount * (gstRate / 100);
                    }

                    totalTaxable += amount;
                    return { ...line, amount, sgst, cgst, igst };
                });

                // Use meta values for final totals
                const grandTotal = totalTaxable +
                    Number(meta.sgst_amt || 0) +
                    Number(meta.cgst_amt || 0) +
                    Number(meta.igst_amt || 0) +
                    Number(meta.kanta_tulai_amt || 0) +
                    Number(meta.round_off_amt || 0);

                // Create rows
                processedLines.forEach((line, index) => {
                    const isLast = index === processedLines.length - 1;
                    const isFirst = index === 0;

                    const roundAmtVal = Number(meta.round_off_amt);
                    const roundAmt = isLast ? Math.abs(roundAmtVal).toFixed(2) : "";
                    const roundDrCr = isLast ? (roundAmtVal < 0 ? "Cr" : "Dr") : "";

                    // Negative amount for line items
                    const lineAmount = (line.amount * -1).toFixed(2);
                    const formattedDate = formatDate(bill.purchase_date);

                    allRows.push({
                        "Invoice Date": formattedDate,
                        "Invoice No": bill.bill_no,
                        "Supplier Invoice No": bill.bill_no,
                        "Supplier Invoice Date": formattedDate,
                        "Voucher Type": "Purchase",
                        "Purchase Ledger": "01-Purchase Grocery",
                        "Supplier Name": isFirst ? vendor.name : "",
                        "Address 1": isFirst ? (vendor.address_1 || "") : "",
                        "State": isFirst ? (vendor.state || "") : "",
                        "Country": isFirst ? (vendor.country || "India") : "",
                        "GSTIN/UIN": isFirst ? (vendor.gstin || "") : "",
                        "GST Registration Type": vendor.gst_reg_type || "Regular",
                        "Place of Suppy": vendor.state || "",
                        "Item Name": line.raw_materials?.accounting_name || line.raw_materials?.name,
                        "QTY": line.qty,
                        "Item Rate": line.rate,
                        "Amount": lineAmount,
                        "Kanta Tulai Ledger": isLast ? "Kanta Tulai" : "",
                        "Kanta Tulai Amt": isLast ? meta.kanta_tulai_amt : "",
                        "SGST Ledger": isLast ? "Input SGST" : "",
                        "SGST Amount": isLast ? Number(meta.sgst_amt).toFixed(2) : "",
                        "CGST Ledger": isLast ? "Input CGST" : "",
                        "CGST Amount": isLast ? Number(meta.cgst_amt).toFixed(2) : "",
                        "IGST Ledger": isLast ? "Input IGST" : "",
                        "IGST Amount": isLast ? Number(meta.igst_amt).toFixed(2) : "",
                        "Round OFF Ledger": isLast ? "Round Off" : "",
                        "Round OFF Amt": roundAmt,
                        "Round OFF Amt dr/cr": roundDrCr,
                        "Invoice Amount": isLast ? grandTotal.toFixed(2) : "",
                    });
                });
            }

            // Generate Excel
            const ws = XLSX.utils.json_to_sheet(allRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Bills");
            XLSX.writeFile(wb, `Bills_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);

            // Mark as uploaded
            const now = new Date().toISOString();
            for (const bill of billsToProcess) {
                await supabase.from("bill_meta").update({ uploaded_at: now }).eq("vendor_id", bill.vendor_id).eq("bill_no", bill.bill_no);
            }

            push(`Downloaded ${billsToProcess.length} bills.`, "ok");
            loadBills(); // Refresh to hide uploaded
        } catch (err) {
            push(`Download error: ${err.message}`, "err");
        } finally {
            setLoading(false);
        }
    }

    // Single Download (reuses bulk logic for simplicity or keeps separate? Let's reuse logic but for one)
    async function downloadSingle() {
        // Just add current bill to selection logic temporarily or call bulk with one item
        // But here we are in "Edit" mode.
        // Let's just use the existing downloadExcel logic but update uploaded_at.
        if (!vendorDetails) return;

        // ... (Existing logic, but update uploaded_at)
        // Actually, user said "download button will also trigger that its uploaded".
        // So I should update the existing downloadExcel to also set uploaded_at.

        const data = calculated.lines.map((line, index) => {
            const isLast = index === calculated.lines.length - 1;
            const isFirst = index === 0;

            const roundAmtVal = Number(billMeta.round_off_amt);
            const roundAmt = isLast ? Math.abs(roundAmtVal).toFixed(2) : "";
            const roundDrCr = isLast ? (roundAmtVal < 0 ? "Cr" : "Dr") : "";

            // Negative amount for line items
            const lineAmount = (line.amount * -1).toFixed(2);
            const formattedDate = formatDate(selectedBill.purchase_date);

            return {
                "Invoice Date": formattedDate,
                "Invoice No": selectedBill.bill_no,
                "Supplier Invoice No": selectedBill.bill_no,
                "Supplier Invoice Date": formattedDate,
                "Voucher Type": "Purchase",
                "Purchase Ledger": "01-Purchase Grocery",
                "Supplier Name": isFirst ? vendorDetails.name : "",
                "Address 1": isFirst ? (vendorDetails.address_1 || "") : "",
                "State": isFirst ? (vendorDetails.state || "") : "",
                "Country": isFirst ? (vendorDetails.country || "India") : "",
                "GSTIN/UIN": isFirst ? (vendorDetails.gstin || "") : "",
                "GST Registration Type": vendorDetails.gst_reg_type || "Regular",
                "Place of Suppy": vendorDetails.state || "",
                "Item Name": line.raw_materials?.accounting_name || line.raw_materials?.name,
                "QTY": line.qty,
                "Item Rate": line.rate,
                "Amount": lineAmount,
                "Kanta Tulai Ledger": isLast ? "Kanta Tulai" : "",
                "Kanta Tulai Amt": isLast ? billMeta.kanta_tulai_amt : "",
                "SGST Ledger": isLast ? "Input SGST" : "",
                "SGST Amount": isLast ? Number(billMeta.sgst_amt).toFixed(2) : "",
                "CGST Ledger": isLast ? "Input CGST" : "",
                "CGST Amount": isLast ? Number(billMeta.cgst_amt).toFixed(2) : "",
                "IGST Ledger": isLast ? "Input IGST" : "",
                "IGST Amount": isLast ? Number(billMeta.igst_amt).toFixed(2) : "",
                "Round OFF Ledger": isLast ? "Round Off" : "",
                "Round OFF Amt": roundAmt,
                "Round OFF Amt dr/cr": roundDrCr,
                "Invoice Amount": isLast ? grandTotal.toFixed(2) : "",
            };
        });

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Bill");
        XLSX.writeFile(wb, `Bill_${selectedBill.bill_no}.xlsx`);

        // Mark uploaded
        await supabase.from("bill_meta").update({ uploaded_at: new Date().toISOString() }).eq("vendor_id", selectedBill.vendor_id).eq("bill_no", selectedBill.bill_no);
        loadBills(); // Refresh background list
    }

    // --- RENDER ---
    if (selectedBill) {
        // EDIT MODE
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
                                    <td><small style={{ color: "var(--muted)" }}>{line.raw_materials?.accounting_name || "-"}</small></td>
                                    <td>{line.qty}</td>
                                    <td>{line.raw_materials?.unit}</td>
                                    <td>
                                        <input type="number" value={line.rate} onChange={(e) => updateRate(line.id, e.target.value)} style={{ width: 100 }} disabled={loading} />
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
                        <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
                            <label>Total Taxable:</label><span>{calculated.totalTaxable.toFixed(2)}</span>
                        </div>
                        <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
                            <label>Total SGST:</label>
                            <input type="number" value={billMeta.sgst_amt} onChange={e => setBillMeta({ ...billMeta, sgst_amt: e.target.value })} style={{ width: 120, textAlign: "right" }} />
                        </div>
                        <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
                            <label>Total CGST:</label>
                            <input type="number" value={billMeta.cgst_amt} onChange={e => setBillMeta({ ...billMeta, cgst_amt: e.target.value })} style={{ width: 120, textAlign: "right" }} />
                        </div>
                        <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
                            <label>Total IGST:</label>
                            <input type="number" value={billMeta.igst_amt} onChange={e => setBillMeta({ ...billMeta, igst_amt: e.target.value })} style={{ width: 120, textAlign: "right" }} />
                        </div>
                        <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
                            <label>Kanta Tulai:</label>
                            <input type="number" value={billMeta.kanta_tulai_amt} onChange={e => setBillMeta({ ...billMeta, kanta_tulai_amt: e.target.value })} style={{ width: 120, textAlign: "right" }} />
                        </div>
                        <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
                            <label>Round Off:</label>
                            <input type="number" value={billMeta.round_off_amt} onChange={e => setBillMeta({ ...billMeta, round_off_amt: e.target.value })} style={{ width: 120, textAlign: "right" }} />
                        </div>
                        <div className="row" style={{ justifyContent: "space-between", marginTop: 10, borderTop: "1px solid #ccc", paddingTop: 10 }}>
                            <b>Grand Total:</b><b>{grandTotal.toFixed(2)}</b>
                        </div>
                    </div>

                    <div className="row" style={{ marginTop: 20, gap: 10, justifyContent: "flex-end" }}>
                        <button className="btn outline" onClick={() => save(false)} disabled={loading}>Save</button>
                        <button className="btn" onClick={() => save(true)} disabled={loading}>Check & Save</button>
                    </div>
                </div>
            </div>
        );
    }

    // LIST MODE
    return (
        <div className="grid">
            <div className="card">
                <div className="hd">
                    <b>Bill Check</b>
                    <div className="row" style={{ gap: 10 }}>
                        <button className={`btn small ${tab === 'pending' ? '' : 'outline'}`} onClick={() => setTab('pending')}>Pending</button>
                        <button className={`btn small ${tab === 'checked' ? '' : 'outline'}`} onClick={() => setTab('checked')}>Checked</button>
                        <button className="btn ghost small" onClick={loadBills} disabled={loading}>Refresh</button>
                    </div>
                </div>
                <div className="bd">
                    {tab === 'checked' && (
                        <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
                            <div className="row" style={{ gap: 10, alignItems: "center" }}>
                                <label>
                                    <input type="checkbox" checked={showUploaded} onChange={e => setShowUploaded(e.target.checked)} /> Show Uploaded
                                </label>
                                <input
                                    placeholder="Search Bill No..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    style={{ width: 150 }}
                                />
                                <span className="badge">{checkedBills.length} bills</span>
                            </div>
                            <button className="btn" onClick={downloadSelected} disabled={checkedSelection.size === 0 || loading}>
                                Download Selected ({checkedSelection.size})
                            </button>
                        </div>
                    )}

                    <table className="table">
                        <thead>
                            <tr>
                                {tab === 'checked' && (
                                    <th style={{ width: 40 }}>
                                        <input type="checkbox" checked={checkedBills.length > 0 && checkedSelection.size === checkedBills.length} onChange={toggleAllChecked} />
                                    </th>
                                )}
                                <th>Date</th>
                                <th>Bill No</th>
                                <th>Vendor</th>
                                {tab === 'checked' && <th>Status</th>}
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(tab === 'pending' ? pendingBills : checkedBills).map((b, i) => (
                                <tr key={b.key}>
                                    {tab === 'checked' && (
                                        <td>
                                            <input type="checkbox" checked={checkedSelection.has(b.key)} onChange={() => toggleSelection(b.key)} />
                                        </td>
                                    )}
                                    <td>{b.purchase_date}</td>
                                    <td>{b.bill_no}</td>
                                    <td>{b.vendors?.name}</td>
                                    {tab === 'checked' && (
                                        <td>
                                            {b.is_checked && <span className="badge green">Checked</span>}
                                            {b.uploaded_at && <span className="badge blue">Uploaded</span>}
                                        </td>
                                    )}
                                    <td>
                                        <button className="btn small" onClick={() => openBill(b)}>Open</button>
                                    </td>
                                </tr>
                            ))}
                            {(tab === 'pending' ? pendingBills : checkedBills).length === 0 && (
                                <tr>
                                    <td colSpan={tab === 'checked' ? "6" : "4"} className="s">No bills found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
