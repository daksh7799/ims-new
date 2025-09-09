import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../ui/toast.jsx'
import AsyncFGSelect from '../components/AsyncFGSelect.jsx'

export default function Returns(){
  const { push } = useToast()

  // Scan return
  const [scan,setScan]=useState('')
  const scanRef = useRef(null)
  const inFlight = useRef(false)

  // No-barcode (good)
  const [nbFg,setNbFg]=useState('')
  const [nbQty,setNbQty]=useState(1)
  const [nbNote,setNbNote]=useState('')

  // Scrap by barcode
  const [scrapCode,setScrapCode]=useState('')
  const [scrapNote,setScrapNote]=useState('')

  // Scan return
  async function doScanReturn(code){
    const pkt = (code||'').trim()
    if(!pkt || inFlight.current) return
    try{
      inFlight.current = true
      const { error } = await supabase.rpc('return_packet_scan', { p_packet_code: pkt })
      if(error){ push(error.message, 'err'); return }
      setScan('')
      push('Packet marked as returned', 'ok')
    } finally {
      inFlight.current = false
      scanRef.current?.focus()
    }
  }

  // No-barcode return (good)
  async function addNoBarcode(){
    const fg = Number(nbFg); const qty = Number(nbQty||0)
    if(!fg || qty<=0) return push('Select finished good and valid qty', 'warn')
    const { error } = await supabase.rpc('return_no_barcode', {
      p_finished_good_id: fg,
      p_qty_units: qty,
      p_note: nbNote || null
    })
    if(error){ push(error.message, 'err'); return }
    setNbQty(1); setNbNote('')
    push('Returned (new barcodes created). Print from Live Barcodes.', 'ok')
  }

  // Scrap by barcode only
  async function scrapByBarcode(){
    const code = scrapCode.trim()
    if(!code) return push('Enter packet barcode to scrap', 'warn')
    const { error } = await supabase.rpc('scrap_packet_by_barcode', {
      p_packet_code: code,
      p_note: scrapNote || null
    })
    if(error){ push(error.message, 'err'); return }
    setScrapCode('')
    push('Scrapped packet and credited raw materials', 'ok')
  }

  return (
    <div className="grid">

      {/* SCAN RETURN */}
      <div className="card">
        <div className="hd"><b>Return by Scanning Barcode</b></div>
        <div className="bd">
          <form onSubmit={(e)=>{ e.preventDefault(); doScanReturn(scan) }} className="row">
            <input
              ref={scanRef}
              placeholder="Scan / Enter packet barcode"
              value={scan}
              onChange={e=>setScan(e.target.value)}
              autoFocus
              style={{minWidth:320}}
            />
            <button className="btn">Return</button>
          </form>
          <div className="s" style={{color:'var(--muted)', marginTop:6}}>
            Packet status → <code>returned</code>. Ledger adds FG <b>in</b> (<code>customer_return</code>).
          </div>
        </div>
      </div>

      {/* NO BARCODE (GOOD) */}
      <div className="card">
        <div className="hd"><b>Good Packet but Barcode Missing</b></div>
        <div className="bd">
          <div className="row" style={{gap:8}}>
            <AsyncFGSelect
              value={nbFg}
              onChange={(id)=>setNbFg(id)}
              placeholder="Search finished goods…"
              minChars={1}
              pageSize={25}
            />
            <input type="number" min="1" value={nbQty} onChange={e=>setNbQty(e.target.value)} style={{width:120}} />
            <input placeholder="Note (optional)" value={nbNote} onChange={e=>setNbNote(e.target.value)} />
            <button className="btn" onClick={addNoBarcode}>Add Return</button>
          </div>
          <div className="s" style={{marginTop:6}}>Creates new barcodes; find them in <b>Live Barcodes</b> to print labels.</div>
        </div>
      </div>

      {/* SCRAP (by barcode only) */}
      <div className="card">
        <div className="hd"><b>Scrap by Barcode</b></div>
        <div className="bd">
          <div className="row" style={{gap:8}}>
            <input placeholder="Scrap by Barcode" value={scrapCode} onChange={e=>setScrapCode(e.target.value)} style={{minWidth:280}} />
            <input placeholder="Note (optional)" value={scrapNote} onChange={e=>setScrapNote(e.target.value)} />
            <button className="btn outline" onClick={scrapByBarcode}>Scrap</button>
          </div>
        </div>
      </div>
    </div>
  )
}
