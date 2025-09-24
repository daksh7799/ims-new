// src/pages/RawInward.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

const today = () => new Date().toISOString().slice(0,10)

export default function RawInward(){
  const [rmList, setRmList] = useState([])
  const [vendors, setVendors] = useState([])
  const [recent, setRecent] = useState([])

  // Bill header (vendor + bill_no required, date defaults to today)
  const [header, setHeader] = useState({
    vendor_id: '',
    purchase_date: today(),
    bill_no: ''              // NEW: mandatory
  })

  // Lines
  const [lines, setLines] = useState([{ raw_material_id:'', qty:'' }])

  const [loading, setLoading] = useState(false)

  async function loadData(){
    setLoading(true)
    try{
      const [{ data: rm, error: e1 }, { data: v, error: e2 }, { data: r, error: e3 }] = await Promise.all([
        supabase.from('raw_materials').select('id,name,unit').eq('is_active',true).order('name'),
        supabase.from('vendors').select('id,name').order('name'),
        // show bill_no in recent list (expects column exists)
        supabase.from('raw_inward')
          .select('id,bill_no,qty,purchase_date,raw_materials(name,unit),vendors(name)')
          .order('id',{ascending:false}).limit(50)
      ])
      if(e1) throw e1
      if(e2) throw e2
      if(e3) throw e3
      setRmList(rm||[])
      setVendors(v||[])
      setRecent(r||[])
    }catch(err){
      alert(`Load error: ${err.message||err}`)
    }finally{
      setLoading(false)
    }
  }
  useEffect(()=>{ loadData() },[])

  // helpers
  function addLine(){ setLines(ls => [...ls, { raw_material_id:'', qty:'' }]) }
  function removeLine(i){ setLines(ls => ls.filter((_,idx)=>idx!==i)) }
  function updateLine(i, patch){ setLines(ls => ls.map((ln,idx)=> idx===i ? {...ln, ...patch} : ln)) }
  function clearLines(){ setLines([{ raw_material_id:'', qty:'' }]) }

  // Keep IDs as strings (UUID). Only coerce qty to Number.
  const validLines = useMemo(() =>
    lines
      .map(l => ({ raw_material_id:String(l.raw_material_id||'').trim(), qty:Number(l.qty) }))
      .filter(l => l.raw_material_id && Number.isFinite(l.qty) && l.qty > 0)
  , [lines])

  const totalRows = validLines.length
  const totalQty = validLines.reduce((n,l)=>n+Number(l.qty||0),0)

  async function saveBill({ keepVendor=true } = {}){
    if(!String(header.vendor_id).trim()) return alert('Please select a vendor (required)')
    if(!String(header.bill_no).trim())   return alert('Please enter Bill No (required)')
    if(!String(header.purchase_date).trim()) return alert('Please choose a date')
    if(validLines.length === 0) return alert('Add at least one raw material with quantity')

    setLoading(true)
    try{
      // Prepare payload: one row per line, include bill_no for each
      const payload = validLines.map(l => ({
        raw_material_id: l.raw_material_id,             // UUID string
        vendor_id: String(header.vendor_id).trim(),     // UUID string
        bill_no: String(header.bill_no).trim(),         // NEW
        qty: l.qty,                                     // number
        purchase_date: header.purchase_date             // 'YYYY-MM-DD'
      }))

      // Insert rows; RLS must allow this
      const { error } = await supabase.from('raw_inward').insert(payload)
      if(error) throw error

      // Refresh “Recent” panel
      await loadData()

      // Reset lines; keep vendor optionally, always clear bill_no and reset date
      clearLines()
      setHeader(h => ({
        vendor_id: keepVendor ? h.vendor_id : '',
        purchase_date: today(),
        bill_no: ''                 // clear after save
      }))
    }catch(err){
      alert(`Save error: ${err.message||err}`)
    }finally{
      setLoading(false)
    }
  }

  return (
    <div className="grid">
      {/* BILL HEADER */}
      <div className="card">
        <div className="hd">
          <b>Raw Inward — New Bill</b>
          <div className="row" style={{gap:6}}>
            <span className="badge">{loading ? 'Working…' : 'Ready'}</span>
            <span className="badge">Lines: {totalRows}</span>
            <span className="badge">Total Qty: {totalQty}</span>
          </div>
        </div>
        <div className="bd">
          <div className="row" style={{marginBottom:10, gap:8, flexWrap:'wrap', alignItems:'center'}}>
            <select
              value={header.vendor_id}
              onChange={e=>setHeader(h=>({...h, vendor_id:e.target.value}))}
              style={{minWidth:260}}
              required
              disabled={loading}
            >
              <option value="">Select Vendor (required)</option>
              {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
            </select>

            <input
              placeholder="Bill No (required)"
              value={header.bill_no}
              onChange={e=>setHeader(h=>({...h, bill_no:e.target.value}))}
              style={{minWidth:180}}
              disabled={loading}
            />

            <input
              type="date"
              value={header.purchase_date}
              onChange={e=>setHeader(h=>({...h, purchase_date:e.target.value}))}
              title="Purchase date (defaults to today)"
              disabled={loading}
            />

            <button className="btn ghost" onClick={()=>setHeader(h=>({...h, vendor_id:''}))} disabled={loading}>
              Change Vendor
            </button>
          </div>

          {/* BILL LINES */}
          <div className="card" style={{background:'transparent'}}>
            <div className="hd" style={{display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center'}}>
              <b>Bill Lines</b>
              <span className="badge">{totalRows} line(s)</span>
            </div>
            <div className="bd">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{width:'45%'}}>Raw Material</th>
                    <th style={{width:'20%'}}>Qty</th>
                    <th>Unit</th>
                    <th style={{width:'1%'}}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln,idx)=>{
                    const unit = rmList.find(r=>String(r.id)===String(ln.raw_material_id))?.unit || ''
                    return (
                      <tr key={idx}>
                        <td>
                          <select
                            value={ln.raw_material_id}
                            onChange={e=>updateLine(idx,{ raw_material_id:e.target.value })}
                            style={{minWidth:260}}
                            disabled={loading}
                          >
                            <option value="">Select Raw Material</option>
                            {rmList.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number" step="0.00001" min="0"
                            placeholder="Qty"
                            value={ln.qty}
                            onChange={e=>updateLine(idx,{ qty:e.target.value })}
                            style={{width:160}}
                            disabled={loading}
                            onKeyDown={e=>{
                              // Enter on qty field adds a new row quickly
                              if(e.key==='Enter'){ e.preventDefault(); addLine(); }
                            }}
                          />
                        </td>
                        <td>{unit || '-'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={()=>removeLine(idx)}
                            title="Remove line"
                            disabled={loading}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <div className="row" style={{marginTop:10, gap:8}}>
                <button type="button" className="btn outline" onClick={addLine} disabled={loading}>+ Add Line</button>
                <button
                  type="button"
                  className="btn"
                  disabled={loading || !header.vendor_id || !header.bill_no || totalRows===0}
                  onClick={()=>saveBill({ keepVendor:true })}
                  title="Save lines under current vendor; keep vendor for next bill"
                >
                  Save Bill (keep vendor)
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={loading || !header.vendor_id || !header.bill_no || totalRows===0}
                  onClick={()=>saveBill({ keepVendor:false })}
                  title="Save and start a new bill with a different vendor"
                >
                  Save & New Vendor
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* RECENT ENTRIES */}
      <div className="card">
        <div className="hd"><b>Recent Inwards</b></div>
        <div className="bd" style={{overflow:'auto'}}>
          <table className="table">
            <thead>
              <tr><th>ID</th><th>Bill No</th><th>Date</th><th>Vendor</th><th>Material</th><th>Qty</th><th>Unit</th></tr>
            </thead>
            <tbody>
              {recent.map(r=>(
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.bill_no || '—'}</td>
                  <td>{r.purchase_date}</td>
                  <td>{r.vendors?.name}</td>
                  <td>{r.raw_materials?.name}</td>
                  <td>{r.qty}</td>
                  <td>{r.raw_materials?.unit || '-'}</td>
                </tr>
              ))}
              {recent.length===0 && (
                <tr><td colSpan="7" style={{color:'var(--muted)'}}>No inward entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
