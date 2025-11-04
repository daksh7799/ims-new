import { useMemo, useEffect } from "react";
import QRCode from "qrcode";
import jsPDF from "jspdf";
import { useLocation, Link } from "react-router-dom";

/** CONFIG (easy tweaks) */
const LABEL_W = 38; // mm (single label width)
const LABEL_H = 25; // mm (single label height)
const PAGE_W = LABEL_W * 2; // 2-up total width
const PAGE_H = LABEL_H;
const PAD = 3; // inner padding
const CORNER = 2; // rounded rect radius
const QR_MM = 13; // ✅ increased QR side (was 12mm)
const NAME_FS = 6.5; // product name font size (pt)
const NAME_GAP = 3.2; // name line gap (mm)
const NAME_LINES = 3; // max wrapped lines
const CODE_FS = 6.5; // ✅ slightly bigger code font for clarity
const mmToPx = (mm) => Math.round(mm * (96 / 25.4));

export default function Labels() {
  const { state } = useLocation() || {};
  const title = state?.title || "Labels";
  const codes = state?.codes || [];
  const namesByCode = state?.namesByCode || {};

  const items = useMemo(
    () =>
      (codes || []).map((code) => ({
        code,
        name: namesByCode[code] || title,
      })),
    [codes, namesByCode, title]
  );

  /** PREVIEW: render QR onto canvases (true-size) */
  useEffect(() => {
    const px = mmToPx(QR_MM);
    document.querySelectorAll("canvas[data-code]").forEach(async (c) => {
      const code = c.getAttribute("data-code") || "";
      try {
        c.width = px;
        c.height = px;
        await QRCode.toCanvas(c, code, { width: px, margin: 0 });
      } catch {}
    });
  }, [items]);

  /** Shared PDF generator (used by both download + print) */
  async function generatePDF() {
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: [PAGE_W, PAGE_H], // 76 x 25 mm
    });

    for (let i = 0; i < items.length; i += 2) {
      const left = items[i];
      const right = items[i + 1];
      await drawLabel(pdf, 0, 0, left);
      if (right) await drawLabel(pdf, LABEL_W, 0, right);
      if (i + 2 < items.length) pdf.addPage([PAGE_W, PAGE_H], "landscape");
    }

    return pdf;
  }

  /** Download */
  async function downloadPDF() {
    if (!items.length) return alert("No labels to print");
    const pdf = await generatePDF();
    pdf.save(`${String(title).replace(/\s+/g, "_")}_76x25_2up.pdf`);
  }

  /** ✅ Print directly in same window (no auto-close) */
  async function printPDF() {
    if (!items.length) return alert("No labels to print");
    const pdf = await generatePDF();
    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);

    // Create hidden iframe for printing (will stay)
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = url;
    document.body.appendChild(iframe);

    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Do NOT auto-remove — stays until manual refresh
    };
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>{title}</b>
        </div>
        <div className="bd">
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <button
              className="btn"
              onClick={downloadPDF}
              disabled={!items.length}
            >
              ⬇️ Download 2-up (76×25 mm)
            </button>
            <button
              className="btn outline"
              onClick={printPDF}
              disabled={!items.length}
            >
              🖨️ Print 2-up (76×25 mm)
            </button>
            <Link to={-1} className="btn ghost">
              Back
            </Link>
          </div>

          {/* TRUE-SIZE PREVIEW */}
          {!items.length && <div className="badge">No labels to show</div>}

          {!!items.length && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, 90mm)",
                gap: "6mm",
              }}
            >
              {chunk2(items).map((pair, pageIdx) => (
                <div
                  key={pageIdx}
                  style={{
                    width: "76mm",
                    height: "25mm",
                    border: "1px dashed #aaa",
                    borderRadius: "2mm",
                    padding: 0,
                    display: "grid",
                    gridTemplateColumns: "38mm 38mm",
                  }}
                >
                  {pair.map((it, colIdx) => (
                    <div
                      key={colIdx}
                      style={{
                        width: "38mm",
                        height: "25mm",
                        borderRight:
                          colIdx === 0 ? "0.4mm solid #eee" : "none",
                        padding: "2mm",
                        boxSizing: "border-box",
                        display: "flex",
                        gap: "2mm",
                        alignItems: "flex-start", // ✅ top align text with QR
                      }}
                    >
                      <canvas
                        data-code={it.code}
                        style={{ width: `${QR_MM}mm`, height: `${QR_MM}mm` }}
                      />
                      <div
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "8pt",
                            lineHeight: 1.05,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {it.name}
                        </div>
                        <div
                          style={{
                            marginTop: "auto",
                            fontFamily: "monospace",
                            fontSize: "7pt",
                            lineHeight: 1,
                            wordBreak: "break-all",
                            fontWeight: "bold", // ✅ bold in preview
                            color: "#000", // ✅ darker text
                          }}
                        >
                          {it.code}
                        </div>
                      </div>
                    </div>
                  ))}
                  {pair.length === 1 && <div />} {/* placeholder for odd last */}
                </div>
              ))}
            </div>
          )}

          <div className="s" style={{ color: "var(--muted)", marginTop: 8 }}>
            Printer setup (TSC TTP-244 Pro): set paper to{" "}
            <b>76×25 mm (2-up)</b>, scale <b>100%</b>, disable auto-rotate /
            fit-to-page, calibrate gap sensor if alignment drifts.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
function chunk2(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2));
  return out;
}

async function drawLabel(pdf, ox, oy, item) {
  if (!item) return;
  const W = LABEL_W,
    H = LABEL_H;
  const pad = PAD,
    r = CORNER;
  const qrSize = QR_MM;
  const textLeft = pad + qrSize + 2;
  const textRightPad = 2;
  const textBoxW = W - textLeft - textRightPad;

  // Border for alignment
  pdf.setDrawColor(200);
  pdf.roundedRect(ox, oy, W, H, r, r, "S");

  // QR
  const qr = await QRCode.toDataURL(item.code, {
    margin: 0,
    width: mmToPx(qrSize),
  });
  pdf.addImage(qr, "PNG", ox + pad, oy + pad, qrSize, qrSize);

  // Name (starts aligned with QR top)
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(NAME_FS);
  const lines = pdf
    .splitTextToSize(String(item.name || ""), textBoxW)
    .slice(0, NAME_LINES);
  lines.forEach((ln, i) => {
    pdf.text(ln, ox + textLeft, oy + pad + i * NAME_GAP + 1.5, {
      baseline: "top",
    });
  });

  // Code (bold + darker)
  pdf.setFont("courier", "bold");
  pdf.setTextColor(0, 0, 0); // black
  pdf.setFontSize(CODE_FS);
  pdf.text(item.code, ox + pad, oy + H - 5, { maxWidth: W - pad * 2 });
}
