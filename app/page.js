'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { processTextToDf, getBeliNklLambat, getBpbRj } from './parser'
import styles from './page.module.css'

const PASSWORD = 'gasemuatau'

const COLS = [
  { key: 'kodeBarang', label: 'Kode Barang', align: 'left' },
  { key: 'deskripsi', label: 'Deskripsi', align: 'left' },
  { key: 'unit', label: 'Unit', align: 'center' },
  { key: 'saldoAwal', label: 'Saldo Awal', align: 'right', numeric: true },
  { key: 'totalIn', label: 'Total IN', align: 'right', numeric: true, color: 'in' },
  { key: 'totalOut', label: 'Total OUT', align: 'right', numeric: true, color: 'out' },
  { key: 'saldoAkhir', label: 'Saldo Akhir', align: 'right', numeric: true, color: 'saldo' },
  { key: 'hasTx', label: 'Has Tx', align: 'center' },
]

function fmt(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  if (typeof v === 'number') return v.toLocaleString('id-ID')
  return v
}

function selisihBadge(n, hasWeekend) {
  if (n === null || n === undefined || n < 2) return null
  if (n === 2 && hasWeekend) return { label: 'H+2 🏖', cls: 'badgeWeekend' }
  return { label: `H+${n}`, cls: 'badgeDanger' }
}

// ── Mini Bar Chart ──────────────────────────────────────────────────────────
function MiniBarChart({ data, maxVal }) {
  if (!data || data.length === 0) return null
  const max = maxVal || Math.max(...data.map(d => d.value), 1)
  return (
    <div className={styles.chartWrap}>
      {data.map((d, i) => (
        <div key={i} className={styles.chartCol} title={`${d.label}: ${d.value}`}>
          <div className={styles.chartBar} style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
          <div className={styles.chartLabel}>{d.shortLabel || d.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── BPB/R.j Customer Dashboard ──────────────────────────────────────────────
function BpbRjDashboard({ rows, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const [selectedCust, setSelectedCust] = useState(null)
  const [sortBy, setSortBy] = useState('count') // count | out

  // Build customer summary
  const custMap = {}
  for (const r of rows) {
    const c = r.kodeCust || '(kosong)'
    if (!custMap[c]) custMap[c] = { kodeCust: c, count: 0, totalOut: 0, totalIn: 0, transactions: [] }
    custMap[c].count++
    custMap[c].totalOut += r.qtyOut || 0
    custMap[c].totalIn += r.qtyIn || 0
    custMap[c].transactions.push(r)
  }
  const custList = Object.values(custMap).sort((a, b) =>
    sortBy === 'count' ? b.count - a.count : b.totalOut - a.totalOut
  )

  const selected = selectedCust ? custMap[selectedCust] : null

  // Build timeline chart for selected customer
  // Group by month
  const buildChart = (txs) => {
    const monthMap = {}
    for (const t of txs) {
      const parts = t.tglPO.split('/')
      const key = `${parts[1]}/${parts[2]?.slice(2)}` // MM/YY
      if (!monthMap[key]) monthMap[key] = 0
      monthMap[key] += t.qtyOut || 0
    }
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ label: k, shortLabel: k.split('/')[0], value: v }))
  }

  // Build per-item chart for selected customer
  const buildItemChart = (txs) => {
    const itemMap = {}
    for (const t of txs) {
      const k = t.kodeBarang
      if (!itemMap[k]) itemMap[k] = { kode: k, desc: t.deskripsi, out: 0, count: 0 }
      itemMap[k].out += t.qtyOut || 0
      itemMap[k].count++
    }
    return Object.values(itemMap).sort((a, b) => b.out - a.out).slice(0, 10)
  }

  const exportCust = async (cust) => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(cust.transactions.map(r => ({
      'Kode Barang': r.kodeBarang, 'Deskripsi': r.deskripsi, 'Unit': r.unit,
      'Tgl PO': r.tglPO, 'No Transaksi': r.noTx,
      'Cust/Supp': r.kodeCust, 'No Reff': r.noReff,
      'QTY OUT': r.qtyOut || 0, 'QTY IN': r.qtyIn || 0, 'Saldo': r.saldo,
      'User ADM': r.admUser, 'Tgl Input': r.admTanggal,
    })))
    ws['!cols'] = [{wch:14},{wch:36},{wch:6},{wch:12},{wch:22},{wch:10},{wch:22},{wch:10},{wch:10},{wch:8},{wch:10},{wch:12}]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `BPB-RJ ${cust.kodeCust}`)
    XLSX.writeFile(wb, `bpb_rj_${cust.kodeCust}_${Date.now()}.xlsx`)
  }

  const exportAll = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    // Summary sheet
    const wsSummary = XLSX.utils.json_to_sheet(custList.map(c => ({
      'Kode Customer': c.kodeCust, 'Jumlah BPB/R.j': c.count,
      'Total QTY OUT': c.totalOut, 'Total QTY IN (Retur)': c.totalIn,
    })))
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary per Customer')
    // All transactions sheet
    const wsAll = XLSX.utils.json_to_sheet(rows.map(r => ({
      'Kode Barang': r.kodeBarang, 'Deskripsi': r.deskripsi, 'Unit': r.unit,
      'Tgl PO': r.tglPO, 'No Transaksi': r.noTx, 'Cust/Supp': r.kodeCust,
      'No Reff': r.noReff, 'QTY OUT': r.qtyOut||0, 'QTY IN': r.qtyIn||0,
      'Saldo': r.saldo, 'User ADM': r.admUser, 'Tgl Input': r.admTanggal,
    })))
    XLSX.utils.book_append_sheet(wb, wsAll, 'Semua BPB-RJ')
    XLSX.writeFile(wb, `bpb_rj_dashboard_${Date.now()}.xlsx`)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dashModal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalKode} style={{color:'var(--warn)'}}>📦 Dashboard BPB/R.j — Analisis Customer</div>
            <div className={styles.modalDesc}>{rows.length} transaksi · {custList.length} customer · Klik customer untuk lihat detail</div>
          </div>
          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            <button className={styles.btnExportSmall} onClick={exportAll}>↓ Export Semua</button>
            <button className={styles.modalClose} onClick={onClose}>✕</button>
          </div>
        </div>

        <div className={styles.dashBody}>
          {/* Left: Customer List */}
          <div className={styles.dashLeft}>
            <div className={styles.dashLeftHeader}>
              <span className={styles.dashLeftTitle}>Customer</span>
              <div className={styles.sortToggle}>
                <button className={`${styles.sortBtn} ${sortBy==='count'?styles.sortBtnActive:''}`} onClick={()=>setSortBy('count')}>Frekuensi</button>
                <button className={`${styles.sortBtn} ${sortBy==='out'?styles.sortBtnActive:''}`} onClick={()=>setSortBy('out')}>QTY OUT</button>
              </div>
            </div>
            <div className={styles.custList}>
              {custList.map((c, i) => (
                <div
                  key={c.kodeCust}
                  className={`${styles.custCard} ${selectedCust===c.kodeCust?styles.custCardActive:''} ${c.count>=5?styles.custCardHigh:c.count>=3?styles.custCardMed:''}`}
                  onClick={() => setSelectedCust(c.kodeCust)}
                >
                  <div className={styles.custCardTop}>
                    <div className={styles.custRank}>#{i+1}</div>
                    <div className={styles.custKode}>{c.kodeCust}</div>
                    {c.count >= 5 && <span className={styles.badgeDanger}>⚠ Sering</span>}
                    {c.count >= 3 && c.count < 5 && <span className={styles.badgeWarn}>Perhatian</span>}
                  </div>
                  <div className={styles.custCardStats}>
                    <span className={styles.custStat}><span className={styles.custStatNum}>{c.count}</span>x BPB/R.j</span>
                    <span className={styles.custStat}><span className={`${styles.custStatNum} ${styles.colOut}`}>{c.totalOut.toLocaleString('id-ID')}</span> OUT</span>
                    {c.totalIn > 0 && <span className={styles.custStat}><span className={`${styles.custStatNum} ${styles.colIn}`}>{c.totalIn.toLocaleString('id-ID')}</span> IN</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Detail */}
          <div className={styles.dashRight}>
            {!selected ? (
              <div className={styles.dashEmpty}>
                <div className={styles.dashEmptyIcon}>👈</div>
                <div>Pilih customer di sebelah kiri untuk melihat detail history BPB/R.j</div>
              </div>
            ) : (
              <>
                {/* Customer header */}
                <div className={styles.custDetailHeader}>
                  <div>
                    <div className={styles.custDetailKode}>{selected.kodeCust}</div>
                    <div className={styles.custDetailSub}>{selected.count} transaksi BPB/R.j</div>
                  </div>
                  <button className={styles.btnExportSmall} onClick={() => exportCust(selected)}>↓ Export</button>
                </div>

                {/* Stats */}
                <div className={styles.custDetailStats}>
                  <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total BPB/R.j</span><span className={`${styles.modalStatVal} ${styles.colWarn}`}>{selected.count}</span></div>
                  <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total QTY OUT</span><span className={`${styles.modalStatVal} ${styles.colOut}`}>{selected.totalOut.toLocaleString('id-ID')}</span></div>
                  {selected.totalIn > 0 && <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total QTY IN</span><span className={`${styles.modalStatVal} ${styles.colIn}`}>{selected.totalIn.toLocaleString('id-ID')}</span></div>}
                  <div className={styles.modalStat}><span className={styles.modalStatLabel}>Item Berbeda</span><span className={styles.modalStatVal}>{new Set(selected.transactions.map(t=>t.kodeBarang)).size}</span></div>
                </div>

                {/* Charts */}
                <div className={styles.chartSection}>
                  <div className={styles.chartBox}>
                    <div className={styles.chartTitle}>QTY OUT per Bulan</div>
                    <MiniBarChart data={buildChart(selected.transactions)} />
                  </div>
                  <div className={styles.chartBox}>
                    <div className={styles.chartTitle}>Top Barang (QTY OUT)</div>
                    <div className={styles.itemBars}>
                      {buildItemChart(selected.transactions).map((item, i) => (
                        <div key={i} className={styles.itemBar}>
                          <div className={styles.itemBarLabel} title={item.desc}>{item.kode}</div>
                          <div className={styles.itemBarTrack}>
                            <div className={styles.itemBarFill}
                              style={{width:`${Math.max(4,(item.out/Math.max(...buildItemChart(selected.transactions).map(x=>x.out),1))*100)}%`}} />
                          </div>
                          <div className={styles.itemBarVal}>{item.out.toLocaleString('id-ID')} <span className={styles.itemBarCount}>({item.count}x)</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Transaction table */}
                <div className={styles.custTxWrap}>
                  <table className={styles.modalTable}>
                    <thead>
                      <tr>
                        <th className={styles.mth}>#</th>
                        <th className={styles.mth}>Tgl PO</th>
                        <th className={styles.mth}>Kode Barang</th>
                        <th className={styles.mth}>Deskripsi</th>
                        <th className={styles.mth}>No Transaksi</th>
                        <th className={styles.mth}>No Reff</th>
                        <th className={`${styles.mth} ${styles.alignRight}`}>QTY OUT</th>
                        <th className={`${styles.mth} ${styles.alignRight}`}>QTY IN</th>
                        <th className={styles.mth}>User ADM</th>
                        <th className={styles.mth}>Tgl Input</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.transactions
                        .sort((a,b)=>a.tglPO.split('/').reverse().join('').localeCompare(b.tglPO.split('/').reverse().join('')))
                        .map((r, i) => (
                        <tr key={i} className={`${styles.mtr} ${styles.mtrBpbRj}`}>
                          <td className={`${styles.mtd} ${styles.tdNum}`}>{i+1}</td>
                          <td className={`${styles.mtd} ${styles.tdDate}`}>{r.tglPO}</td>
                          <td className={`${styles.mtd} ${styles.tdAdmUser}`}>{r.kodeBarang}</td>
                          <td className={`${styles.mtd} ${styles.tdDescTx}`}>{r.deskripsi}</td>
                          <td className={`${styles.mtd} ${styles.tdNoTx}`}>{r.noTx}</td>
                          <td className={`${styles.mtd} ${styles.tdReff}`}>{r.noReff}</td>
                          <td className={`${styles.mtd} ${styles.alignRight} ${r.qtyOut>0?styles.colOut:styles.colMuted}`}>{r.qtyOut>0?fmt(r.qtyOut):'—'}</td>
                          <td className={`${styles.mtd} ${styles.alignRight} ${r.qtyIn>0?styles.colIn:styles.colMuted}`}>{r.qtyIn>0?fmt(r.qtyIn):'—'}</td>
                          <td className={`${styles.mtd} ${styles.tdAdmUser}`}>{r.admUser}</td>
                          <td className={`${styles.mtd} ${styles.tdAdmDate}`}>{r.admTanggal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Transaction Detail Modal ─────────────────────────────────────────────────
function TransactionModal({ item, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const txs = item.transactions || []
  const totalIn = txs.reduce((s,t)=>s+(t.in||0),0)
  const totalOut = txs.reduce((s,t)=>s+(t.out||0),0)
  const lambatCount = txs.filter(t=>t.isLambat).length
  const bpbRjCount = txs.filter(t=>t.isBpbRj).length
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e=>e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div><div className={styles.modalKode}>{item.kodeBarang}</div><div className={styles.modalDesc}>{item.deskripsi}</div></div>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalStats}>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Saldo Awal</span><span className={styles.modalStatVal}>{fmt(item.saldoAwal)}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total IN</span><span className={`${styles.modalStatVal} ${styles.colIn}`}>{fmt(totalIn)}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total OUT</span><span className={`${styles.modalStatVal} ${styles.colOut}`}>{fmt(totalOut)}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Saldo Akhir</span><span className={`${styles.modalStatVal} ${styles.colSaldo}`}>{fmt(item.saldoAkhir)}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Unit</span><span className={styles.modalStatVal}>{item.unit||'—'}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Transaksi</span><span className={styles.modalStatVal}>{txs.length}</span></div>
          {bpbRjCount>0&&<div className={styles.modalStat}><span className={styles.modalStatLabel}>BPB/R.j</span><span className={`${styles.modalStatVal} ${styles.colWarn}`}>{bpbRjCount}</span></div>}
          {lambatCount>0&&<div className={styles.modalStat}><span className={styles.modalStatLabel}>Input Lambat</span><span className={`${styles.modalStatVal} ${styles.colDanger}`}>{lambatCount}</span></div>}
        </div>
        <div className={styles.modalTableWrap}>
          {txs.length===0?<div className={styles.modalEmpty}>Tidak ada transaksi</div>:(
            <table className={styles.modalTable}>
              <thead><tr>
                <th className={styles.mth}>#</th><th className={styles.mth}>Tgl PO</th><th className={styles.mth}>Waktu</th>
                <th className={styles.mth}>No Transaksi</th><th className={styles.mth}>Jenis</th><th className={styles.mth}>Cust/Supp</th>
                <th className={styles.mth}>No Reff</th><th className={styles.mth}>Type</th>
                <th className={`${styles.mth} ${styles.alignRight}`}>IN</th><th className={`${styles.mth} ${styles.alignRight}`}>OUT</th>
                <th className={`${styles.mth} ${styles.alignRight}`}>Saldo</th><th className={styles.mth}>User ADM</th>
                <th className={styles.mth}>Tgl Input</th><th className={styles.mth}>Selisih</th>
              </tr></thead>
              <tbody>
                {txs.map((t,i)=>{
                  const badge=selisihBadge(t.isBeliNkl?t.selisihHari:null,t.admHasWeekend)
                  return(
                    <tr key={i} className={[styles.mtr,t.isBpbRj?styles.mtrBpbRj:t.in>0?styles.mtrIn:t.out>0?styles.mtrOut:'',t.isLambat?styles.mtrLambat:''].join(' ')}>
                      <td className={`${styles.mtd} ${styles.tdNum}`}>{i+1}</td>
                      <td className={`${styles.mtd} ${styles.tdDate}`}>{t.tglPO}</td>
                      <td className={`${styles.mtd} ${styles.tdTime}`}>{t.waktu||'—'}</td>
                      <td className={`${styles.mtd} ${styles.tdNoTx}`}>{t.noTx||'—'}</td>
                      <td className={`${styles.mtd} ${styles.tdJenis}`}>{t.jenisTrs||'—'}</td>
                      <td className={`${styles.mtd} ${styles.tdCust}`}>{t.kodeCust||'—'}</td>
                      <td className={`${styles.mtd} ${styles.tdReff}`}>{t.noReff||'—'}</td>
                      <td className={`${styles.mtd} ${t.isBpbRj?styles.tdTypeBpb:styles.tdType}`}>{t.type||'—'}</td>
                      <td className={`${styles.mtd} ${styles.alignRight} ${t.in>0?styles.colIn:styles.colMuted}`}>{t.in>0?fmt(t.in):'—'}</td>
                      <td className={`${styles.mtd} ${styles.alignRight} ${t.out>0?styles.colOut:styles.colMuted}`}>{t.out>0?fmt(t.out):'—'}</td>
                      <td className={`${styles.mtd} ${styles.alignRight} ${styles.colSaldo}`}>{fmt(t.saldo)}</td>
                      <td className={`${styles.mtd} ${styles.tdAdmUser}`}>{t.admUser||'—'}</td>
                      <td className={`${styles.mtd} ${styles.tdAdmDate}`}>{t.admTanggal||'—'}</td>
                      <td className={styles.mtd}>{badge?<span className={styles[badge.cls]}>{badge.label}</span>:'—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Beli nkl Lambat Modal ───────────────────────────────────────────────────
function LambatModal({ rows, onClose }) {
  useEffect(() => {
    const h=(e)=>{if(e.key==='Escape')onClose()}
    window.addEventListener('keydown',h)
    return ()=>window.removeEventListener('keydown',h)
  },[onClose])
  const exportLambat=async()=>{
    const XLSX=await import('xlsx')
    const ws=XLSX.utils.json_to_sheet(rows.map(r=>({
      'Kode Barang':r.kodeBarang,'Deskripsi':r.deskripsi,'Unit':r.unit,
      'Tgl PO':r.tglPO,'Waktu':r.waktu,'No Transaksi':r.noTx,'Jenis':r.jenisTrs,
      'Cust/Supp':r.kodeCust,'No Reff':r.noReff,'Type':r.type,'QTY IN':r.qty,'Saldo':r.saldo,
      'User ADM':r.admUser,'Tgl Input ADM':r.admTanggal,
      'Selisih Hari':r.selisihHari===2&&r.hasWeekend?'H+2 (Weekend)':`H+${r.selisihHari}`,
    })))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,ws,'Beli nkl Lambat')
    XLSX.writeFile(wb,`beli_nkl_lambat_${Date.now()}.xlsx`)
  }
  return(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e=>e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div><div className={styles.modalKode} style={{color:'var(--danger)'}}>⚠ Beli nkl — Input Terlambat</div><div className={styles.modalDesc}>Selisih Tgl PO vs Tgl Input ADM ≥ H+2</div></div>
          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            <button className={styles.btnExportSmall} onClick={exportLambat}>↓ Export Excel</button>
            <button className={styles.modalClose} onClick={onClose}>✕</button>
          </div>
        </div>
        <div className={styles.modalStats}>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total</span><span className={`${styles.modalStatVal} ${styles.colDanger}`}>{rows.length}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>H+2 Weekend 🏖</span><span className={`${styles.modalStatVal} ${styles.colWarn}`}>{rows.filter(r=>r.selisihHari===2&&r.hasWeekend).length}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>H+2 Terlambat</span><span className={`${styles.modalStatVal} ${styles.colDanger}`}>{rows.filter(r=>r.selisihHari===2&&!r.hasWeekend).length}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>H+3 ke atas ⚠</span><span className={`${styles.modalStatVal} ${styles.colDanger}`}>{rows.filter(r=>r.selisihHari>=3).length}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total QTY</span><span className={styles.modalStatVal}>{rows.reduce((s,r)=>s+(r.qty||0),0).toLocaleString('id-ID')}</span></div>
        </div>
        <div className={styles.modalTableWrap}>
          {rows.length===0?<div className={styles.modalEmpty}>Tidak ada transaksi Beli nkl yang terlambat ✓</div>:(
            <table className={styles.modalTable}>
              <thead><tr>
                <th className={styles.mth}>#</th><th className={styles.mth}>Kode Barang</th><th className={styles.mth}>Deskripsi</th>
                <th className={styles.mth}>Tgl PO</th><th className={styles.mth}>No Transaksi</th><th className={styles.mth}>Cust/Supp</th>
                <th className={styles.mth}>No Reff</th><th className={`${styles.mth} ${styles.alignRight}`}>QTY IN</th>
                <th className={styles.mth}>User ADM</th><th className={styles.mth}>Tgl Input</th><th className={styles.mth}>Selisih</th>
              </tr></thead>
              <tbody>
                {rows.map((r,i)=>{const badge=selisihBadge(r.selisihHari,r.hasWeekend);return(
                  <tr key={i} className={`${styles.mtr} ${styles.mtrLambat}`}>
                    <td className={`${styles.mtd} ${styles.tdNum}`}>{i+1}</td>
                    <td className={`${styles.mtd} ${styles.tdAdmUser}`}>{r.kodeBarang}</td>
                    <td className={`${styles.mtd} ${styles.tdDescTx}`}>{r.deskripsi}</td>
                    <td className={`${styles.mtd} ${styles.tdDate}`}>{r.tglPO}</td>
                    <td className={`${styles.mtd} ${styles.tdNoTx}`}>{r.noTx}</td>
                    <td className={`${styles.mtd} ${styles.tdCust}`}>{r.kodeCust}</td>
                    <td className={`${styles.mtd} ${styles.tdReff}`}>{r.noReff}</td>
                    <td className={`${styles.mtd} ${styles.alignRight} ${styles.colIn}`}>{fmt(r.qty)}</td>
                    <td className={`${styles.mtd} ${styles.tdAdmUser}`}>{r.admUser}</td>
                    <td className={`${styles.mtd} ${styles.tdAdmDate}`}>{r.admTanggal}</td>
                    <td className={styles.mtd}>{badge&&<span className={styles[badge.cls]}>{badge.label}</span>}</td>
                  </tr>
                )})}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [authed,setAuthed]=useState(()=>{if(typeof window!=='undefined')return sessionStorage.getItem('stok_auth')==='1';return false})
  const [pwInput,setPwInput]=useState('')
  const [pwError,setPwError]=useState(false)
  const handleLogin=()=>{if(pwInput===PASSWORD){sessionStorage.setItem('stok_auth','1');setAuthed(true);setPwError(false)}else{setPwError(true);setPwInput('')}}

  const [data,setData]=useState(null)
  const [fileName,setFileName]=useState(null)
  const [cleanKode,setCleanKode]=useState(true)
  const [loading,setLoading]=useState(false)
  const [dragging,setDragging]=useState(false)
  const [search,setSearch]=useState('')
  const [sortKey,setSortKey]=useState(null)
  const [sortDir,setSortDir]=useState('asc')
  const [selectedItem,setSelectedItem]=useState(null)
  const [showLambat,setShowLambat]=useState(false)
  const [showBpbRj,setShowBpbRj]=useState(false)
  const fileRef=useRef()

  const processFile=useCallback((file)=>{
    if(!file||!file.name.endsWith('.txt')){alert('Harap upload file .txt');return}
    setLoading(true);setFileName(file.name)
    const reader=new FileReader()
    reader.onload=(e)=>{try{setData(processTextToDf(e.target.result,cleanKode))}catch(err){alert('Error: '+err.message)};setLoading(false)}
    reader.readAsText(file,'utf-8')
  },[cleanKode])

  const handleDrop=useCallback((e)=>{e.preventDefault();setDragging(false);processFile(e.dataTransfer.files[0])},[processFile])
  const handleSort=(key)=>{if(sortKey===key)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortKey(key);setSortDir('asc')}}

  const exportExcel=async()=>{
    if(!data)return
    const XLSX=await import('xlsx')
    const ws=XLSX.utils.json_to_sheet(data.map(r=>({'Kode Barang':r.kodeBarang,'Deskripsi':r.deskripsi,'Unit':r.unit,'Saldo Awal':r.saldoAwal,'Total IN':r.totalIn,'Total OUT':r.totalOut,'Saldo Akhir':r.saldoAkhir,'Has Transactions':r.hasTx?'Ya':'Tidak'})))
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Kartu Stok')
    XLSX.writeFile(wb,`kartu_stok_rule2_${Date.now()}.xlsx`)
  }

  const lambatRows=data?getBeliNklLambat(data):[]
  const bpbRjRows=data?getBpbRj(data):[]
  const filteredData=data?data.filter(r=>!search||r.kodeBarang.toLowerCase().includes(search.toLowerCase())||r.deskripsi.toLowerCase().includes(search.toLowerCase())):[]
  const sortedData=sortKey?[...filteredData].sort((a,b)=>{const av=a[sortKey]??'';const bv=b[sortKey]??'';const cmp=av<bv?-1:av>bv?1:0;return sortDir==='asc'?cmp:-cmp}):filteredData
  const stats=data?{items:data.length,totalIn:data.reduce((s,r)=>s+(r.totalIn||0),0),totalOut:data.reduce((s,r)=>s+(r.totalOut||0),0),withTx:data.filter(r=>r.hasTx).length}:null

  if(!authed)return(
    <div className={styles.loginPage}>
      <div className={styles.loginBox}>
        <div className={styles.loginIcon}>▣</div>
        <div className={styles.loginTitle}>Kartu Stok</div>
        <div className={styles.loginSub}>Rule 2 Processor</div>
        <input className={`${styles.loginInput} ${pwError?styles.loginInputError:''}`} type="password" placeholder="Masukkan password..." value={pwInput} onChange={e=>{setPwInput(e.target.value);setPwError(false)}} onKeyDown={e=>e.key==='Enter'&&handleLogin()} autoFocus />
        {pwError&&<div className={styles.loginError}>Password salah. Coba lagi.</div>}
        <button className={styles.loginBtn} onClick={handleLogin}>Masuk →</button>
      </div>
    </div>
  )

  return(
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}><span className={styles.brandIcon}>▣</span><div><div className={styles.brandTitle}>Kartu Stok</div><div className={styles.brandSub}>Rule 2 Processor</div></div></div>
          <div className={styles.headerActions}>
            {data&&<>
              <input className={styles.search} placeholder="Cari kode / deskripsi..." value={search} onChange={e=>setSearch(e.target.value)} />
              {bpbRjRows.length>0&&<button className={styles.btnBpbRj} onClick={()=>setShowBpbRj(true)}>📦 BPB/R.j ({bpbRjRows.length})</button>}
              {lambatRows.length>0&&<button className={styles.btnLambat} onClick={()=>setShowLambat(true)}>⚠ Input Lambat ({lambatRows.length})</button>}
              <button className={styles.btnExport} onClick={exportExcel}>↓ Export Excel</button>
            </>}
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {!data&&(
          <div className={`${styles.dropzone} ${dragging?styles.dropzoneActive:''}`} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={handleDrop} onClick={()=>fileRef.current.click()}>
            <input ref={fileRef} type="file" accept=".txt" style={{display:'none'}} onChange={e=>processFile(e.target.files[0])} />
            <div className={styles.dropIcon}>⬆</div>
            <div className={styles.dropTitle}>{loading?'Memproses...':'Upload File TXT'}</div>
            <div className={styles.dropSub}>Drag & drop atau klik untuk memilih file</div>
            <div className={styles.dropHint}>.txt — Kartu Stok format</div>
          </div>
        )}
        {data&&(
          <div className={styles.controlBar}>
            <div className={styles.fileTag}><span className={styles.fileTagIcon}>▣</span>{fileName}</div>
            <label className={styles.toggle}><input type="checkbox" checked={cleanKode} onChange={e=>setCleanKode(e.target.checked)} /><span className={styles.toggleTrack} /><span className={styles.toggleLabel}>Clean Kode Barang</span></label>
            <button className={styles.btnReupload} onClick={()=>{setData(null);setFileName(null);setSearch('')}}>↺ Ganti File</button>
            <div className={styles.clickHint}>💡 Klik baris untuk lihat detail transaksi</div>
          </div>
        )}
        {stats&&(
          <div className={styles.stats}>
            <div className={styles.stat}><div className={styles.statVal}>{stats.items.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Total Item</div></div>
            <div className={styles.stat}><div className={`${styles.statVal} ${styles.statIn}`}>{stats.totalIn.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Total IN</div></div>
            <div className={styles.stat}><div className={`${styles.statVal} ${styles.statOut}`}>{stats.totalOut.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Total OUT</div></div>
            <div className={styles.stat}><div className={styles.statVal}>{stats.withTx.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Punya Transaksi</div></div>
            {bpbRjRows.length>0&&<div className={`${styles.stat} ${styles.statWarn}`} style={{cursor:'pointer'}} onClick={()=>setShowBpbRj(true)}><div className={`${styles.statVal} ${styles.colWarn}`}>{bpbRjRows.length}</div><div className={styles.statLabel}>BPB/R.j 📦</div></div>}
            {lambatRows.length>0&&<div className={`${styles.stat} ${styles.statDanger}`} style={{cursor:'pointer'}} onClick={()=>setShowLambat(true)}><div className={`${styles.statVal} ${styles.statRed}`}>{lambatRows.length}</div><div className={styles.statLabel}>Input Lambat ⚠</div></div>}
            {search&&<div className={styles.stat}><div className={styles.statVal}>{sortedData.length.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Hasil Filter</div></div>}
          </div>
        )}
        {data&&(
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr>{COLS.map(col=><th key={col.key} className={`${styles.th} ${styles['align_'+col.align]}`} onClick={()=>handleSort(col.key)}>{col.label}{sortKey===col.key&&<span className={styles.sortArrow}>{sortDir==='asc'?' ↑':' ↓'}</span>}</th>)}</tr></thead>
              <tbody>
                {sortedData.map((row,i)=>{
                  const hasLambat=row.transactions?.some(t=>t.isLambat)
                  const hasBpbRj=row.transactions?.some(t=>t.isBpbRj)
                  return(
                    <tr key={i} className={[styles.tr,hasLambat?styles.trLambat:'',hasBpbRj&&!hasLambat?styles.trBpbRj:''].join(' ')} onClick={()=>setSelectedItem(row)} title="Klik untuk lihat transaksi">
                      {COLS.map(col=>(
                        <td key={col.key} className={[styles.td,styles['align_'+col.align],col.color==='in'?styles.tdIn:'',col.color==='out'?styles.tdOut:'',col.color==='saldo'?styles.tdSaldo:'',col.key==='hasTx'?(row[col.key]?styles.tdYes:styles.tdNo):'',col.key==='kodeBarang'?styles.tdKode:''].join(' ')}>
                          {col.key==='kodeBarang'?<>{fmt(row[col.key])}{hasLambat&&<span className={styles.lambatDot} title="Ada input lambat"> ●</span>}{hasBpbRj&&<span className={styles.bpbDot} title="Ada BPB/R.j"> ◆</span>}</>:fmt(row[col.key])}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {sortedData.length===0&&<div className={styles.empty}>Tidak ada hasil untuk "{search}"</div>}
          </div>
        )}
      </main>
      <footer className={styles.footer}>Kartu Stok Rule 2 Processor — running saldo method</footer>
      {selectedItem&&<TransactionModal item={selectedItem} onClose={()=>setSelectedItem(null)} />}
      {showLambat&&<LambatModal rows={lambatRows} onClose={()=>setShowLambat(false)} />}
      {showBpbRj&&<BpbRjDashboard rows={bpbRjRows} onClose={()=>setShowBpbRj(false)} />}
    </div>
  )
}
