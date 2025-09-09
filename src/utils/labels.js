// src/utils/labels.js
import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'

/**
 * Generate A4 PDF labels with QR codes.
 * Default label size: 36 × 23 mm (your spec)
 * Each label shows: QR + (barcode text) + (optional item name)
 *
 * @param {Array<{code:string, name?:string}>} items
 * @param {Object} opts
 *  - labelWmm: number (default 36)
 *  - labelHmm: number (default 23)
 *  - marginMm: number (outer page margin; default 5)
 *  - qrMm: number (QR size inside label; default 18)
 *  - showName: boolean (default true)
 *  - showCode: boolean (default true)
 *  - filename: string (default "labels.pdf")
 */
export async function generateLabelsPDF(items, opts = {}) {
  if (!items || items.length === 0) return

  const labelW = opts.labelWmm ?? 36
  const labelH = opts.labelHmm ?? 23
  const margin = opts.marginMm ?? 5
  const qrSize = opts.qrMm ?? 18
  const showName = opts.showName ?? true
  const showCode = opts.showCode ?? true
  const filename = opts.filename || 'labels.pdf'

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  const cols = Math.max(1, Math.floor((pageW - margin * 2) / labelW))
  const rows = Math.max(1, Math.floor((pageH - margin * 2) / labelH))
  const perPage = cols * rows

  // Pre-render all QR images to data URLs
  const dataURLs = await Promise.all(
    items.map(it => QRCode.toDataURL(it.code, {
      errorCorrectionLevel: 'M',
      margin: 0, // we handle spacing ourselves
      scale: 8,  // good quality
      width: undefined,
    }))
  )

  doc.setFont('helvetica', 'normal')

  items.forEach((it, idx) => {
    if (idx > 0 && idx % perPage === 0) doc.addPage()

    const local = idx % perPage
    const r = Math.floor(local / cols)
    const c = local % cols

    const x = margin + c * labelW
    const y = margin + r * labelH

    // Optional light guide box (comment out if you don’t want)
    // doc.setDrawColor(230); doc.rect(x, y, labelW, labelH)

    // Center QR inside label (top area)
    const qrX = x + (labelW - qrSize) / 2
    const qrY = y + 2
    doc.addImage(dataURLs[idx], 'PNG', qrX, qrY, qrSize, qrSize)

    // Text under QR
    let textY = qrY + qrSize + 3
    doc.setFontSize(7.5)

    if (showName && it.name) {
      // clamp to label width
      const name = fitText(doc, it.name, labelW - 2, 7.5)
      doc.text(name, x + labelW / 2, textY, { align: 'center', baseline: 'top' })
      textY += 4
    }
    if (showCode) {
      const code = fitText(doc, it.code, labelW - 2, 7.5)
      doc.text(code, x + labelW / 2, textY, { align: 'center', baseline: 'top' })
    }
  })

  doc.save(filename)
}

// Helper to clamp text to width (single line)
function fitText(doc, text, maxWidthMm, fontSize) {
  doc.setFontSize(fontSize)
  const words = String(text || '').split('')
  let s = ''
  for (let i = 0; i < words.length; i++) {
    const next = s + words[i]
    const w = doc.getTextWidth(next)
    if (w <= maxWidthMm) {
      s = next
    } else {
      return s.slice(0, Math.max(0, s.length - 1)) + '…'
    }
  }
  return s
}
