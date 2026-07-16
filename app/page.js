'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { processTextToDf, getBeliNklLambat, getBpbRj, getAdjAnalysis, parseSOCsv, groupSOByKode } from './parser'
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

function parseDateStr(d) {
  if (!d) return null
  const p = d.split('/')
  if (p.length < 3) return null
  return new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]))
}

// ── Mini Bar Chart ───────────────────────────────────────────────────────────
function MiniBarChart({ data }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className={styles.chartWrap}>
      {data.map((d, i) => (
        <div key={i} className={styles.chartCol} title={`${d.label}: ${d.value}`}>
          <div className={styles.chartBar} style={{ height: `${Math.max(2,(d.value/max)*100)}%`, background: d.color || 'var(--danger)' }} />
          <div className={styles.chartLabel}>{d.shortLabel || d.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── ADJ Analysis Dashboard ───────────────────────────────────────────────────
function AdjDashboard({ analysis, soMap, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('ALL') // ALL | NO_ADJ | BOTH | ADJ_ONLY
  const [search, setSearch] = useState('')

  const noAdj = analysis.filter(r => r.status === 'NO_ADJ')
  const both = analysis.filter(r => r.status === 'BOTH')
  const adjOnly = analysis.filter(r => r.status === 'ADJ_ONLY')
  const batalOnly = analysis.filter(r => r.status === 'BATAL_ONLY')

  const filtered = analysis.filter(r => {
    if (filter !== 'ALL' && r.status !== filter) return false
    if (search && !r.kodeBarang.toLowerCase().includes(search.toLowerCase()) &&
        !r.deskripsi.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const selectedItem = selected ? analysis.find(r => r.kodeBarang === selected) : null

  // Build merged timeline for selected item
  const buildTimeline = (item) => {
    if (!item) return []
    const events = [
      ...item.bpbRjList.map(t => ({ ...t, kind: 'bpb', date: parseDateStr(t.tglPO) })),
      ...item.adjMinList.map(t => ({ ...t, kind: 'adj', date: parseDateStr(t.tglPO) })),
    ].filter(e => e.date).sort((a, b) => a.date - b.date)
    return events
  }

  // Build chart data: BPB/R.j vs ADJ(-) per month
  const buildCompareChart = (item) => {
    if (!item) return []
    const monthMap = {}
    for (const t of item.bpbRjList) {
      const p = t.tglPO.split('/')
      const key = `${p[1]}/${p[2]?.slice(2)}`
      if (!monthMap[key]) monthMap[key] = { bpb: 0, adj: 0 }
      monthMap[key].bpb++
    }
    for (const t of item.adjMinList) {
      const p = t.tglPO.split('/')
      const key = `${p[1]}/${p[2]?.slice(2)}`
      if (!monthMap[key]) monthMap[key] = { bpb: 0, adj: 0 }
      monthMap[key].adj++
    }
    return Object.entries(monthMap)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([k,v]) => ({ label: k, bpb: v.bpb, adj: v.adj }))
  }

  const exportAdj = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    // Summary sheet
    const wsSummary = XLSX.utils.json_to_sheet(analysis.map(r => ({
      'Status': r.status === 'NO_ADJ' ? '⚠ Tidak ada ADJ(-)' : r.status === 'BOTH' ? '✓ Ada BPB/R.j & ADJ(-)' : 'ADJ(-) tanpa BPB/R.j',
      'Kode Barang': r.kodeBarang, 'Deskripsi': r.deskripsi, 'Unit': r.unit,
      'Jumlah BPB/R.j': r.bpbRjList.length, 'Jumlah ADJ(-)': r.adjMinList.length,
    })))
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')
    // No ADJ sheet
    const noAdjRows = []
    for (const r of noAdj) {
      for (const t of r.bpbRjList) {
        noAdjRows.push({ 'Kode Barang': r.kodeBarang, 'Deskripsi': r.deskripsi, 'Tgl PO': t.tglPO, 'No Transaksi': t.noTx, 'Cust/Supp': t.kodeCust, 'No Reff': t.noReff, 'User ADM': t.admUser, 'Tgl Input': t.admTanggal })
      }
    }
    if (noAdjRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noAdjRows), 'Tidak Ada ADJ (-)')
    XLSX.writeFile(wb, `adj_analysis_${Date.now()}.xlsx`)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dashModal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalKode} style={{color:'var(--danger)'}}>🔍 Analisis BPB/R.j vs ADJ(-)</div>
            <div className={styles.modalDesc}>Perbandingan retur customer dengan input Bad Stock oleh admin</div>
          </div>
          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            <button className={styles.btnExportSmall} onClick={exportAdj}>↓ Export</button>
            <button className={styles.modalClose} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Top stats */}
        <div className={styles.modalStats}>
          <div className={`${styles.modalStat} ${styles.statClickable}`} onClick={()=>{setFilter('NO_ADJ');setSelected(null)}}>
            <span className={styles.modalStatLabel}>⚠ Tidak Ada ADJ(-)</span>
            <span className={`${styles.modalStatVal} ${styles.colDanger}`}>{noAdj.length}</span>
            <span className={styles.modalStatSub}>Mencurigakan</span>
          </div>
          <div className={`${styles.modalStat} ${styles.statClickable}`} onClick={()=>{setFilter('BOTH');setSelected(null)}}>
            <span className={styles.modalStatLabel}>✓ Ada BPB/R.j & ADJ(-)</span>
            <span className={`${styles.modalStatVal} ${styles.colIn}`}>{both.length}</span>
            <span className={styles.modalStatSub}>Perlu ditelusuri</span>
          </div>
          <div className={`${styles.modalStat} ${styles.statClickable}`} onClick={()=>{setFilter('ADJ_ONLY');setSelected(null)}}>
            <span className={styles.modalStatLabel}>ADJ(-) tanpa BPB/R.j</span>
            <span className={`${styles.modalStatVal} ${styles.colWarn}`}>{adjOnly.length}</span>
            <span className={styles.modalStatSub}>Perlu dicek</span>
          </div>
          <div className={`${styles.modalStat} ${styles.statClickable}`} onClick={()=>{setFilter('BATAL_ONLY');setSelected(null)}}>
            <span className={styles.modalStatLabel}>Hanya Batal/Ganti</span>
            <span className={`${styles.modalStatVal}`} style={{color:'var(--text3)'}}>{batalOnly.length}</span>
            <span className={styles.modalStatSub}>Wajar</span>
          </div>
          <div className={`${styles.modalStat} ${styles.statClickable}`} onClick={()=>{setFilter('ALL');setSelected(null)}}>
            <span className={styles.modalStatLabel}>Total Item</span>
            <span className={styles.modalStatVal}>{analysis.length}</span>
            <span className={styles.modalStatSub}>Semua</span>
          </div>
        </div>

        <div className={styles.dashBody}>
          {/* Left: item list */}
          <div className={styles.dashLeft}>
            <div className={styles.dashLeftHeader}>
              <div className={styles.filterTabs}>
                {[['ALL','Semua'],['NO_ADJ','⚠ Tidak Ada'],['BOTH','✓ Keduanya'],['ADJ_ONLY','ADJ Only'],['BATAL_ONLY','Batal/Ganti']].map(([k,l]) => (
                  <button key={k} className={`${styles.filterTab} ${filter===k?styles.filterTabActive:''} ${k==='NO_ADJ'?styles.filterTabDanger:''}`}
                    onClick={()=>{setFilter(k);setSelected(null)}}>{l}</button>
                ))}
              </div>
            </div>
            <div className={styles.adjSearchWrap}>
              <input className={styles.modalSearch} style={{width:'100%'}} placeholder="Cari kode / deskripsi..." value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
            <div className={styles.custList}>
              {filtered.map(r => (
                <div key={r.kodeBarang}
                  className={`${styles.custCard} ${selected===r.kodeBarang?styles.custCardActive:''} ${r.status==='NO_ADJ'?styles.custCardHigh:r.status==='BOTH'?styles.custCardOk:''}`}
                  onClick={() => setSelected(r.kodeBarang)}>
                  <div className={styles.custCardTop}>
                    <div className={styles.adjStatusDot} style={{background: r.status==='NO_ADJ'?'var(--danger)':r.status==='BOTH'?'var(--accent)':r.status==='BATAL_ONLY'?'var(--text3)':'var(--warn)'}} />
                    <div className={styles.custKode} style={{fontSize:'11px'}}>{r.kodeBarang}</div>
                  </div>
                  <div className={styles.adjItemDesc}>{r.deskripsi}</div>
                  <div className={styles.custCardStats}>
                    <span className={styles.custStat}><span className={`${styles.custStatNum} ${styles.colWarn}`}>{r.activeBpb}</span> BPB/R.j{r.batalBpb>0&&<span style={{color:'var(--text3)'}}> (+{r.batalBpb} batal)</span>}</span>
                    <span className={styles.custStat}><span className={`${styles.custStatNum} ${r.adjMinList.length>0?styles.colIn:styles.colDanger}`}>{r.adjMinList.length}</span> ADJ(-)</span>
                    {soMap && soMap[r.kodeBarang] && <span className={styles.custStat}><span className={styles.custStatNum} style={{color:'var(--info)'}}>{soMap[r.kodeBarang].length}</span> SO</span>}
                    {r.status==='NO_ADJ' && <span className={styles.badgeDanger}>Tidak ada ADJ</span>}
                    {r.status==='BOTH' && <span className={styles.badgeOk}>Ada ADJ</span>}
                    {r.status==='ADJ_ONLY' && <span className={styles.badgeWarn}>ADJ only</span>}
                    {r.status==='BATAL_ONLY' && <span className={styles.badgeMuted}>Batal/Ganti</span>}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && <div className={styles.dashEmpty} style={{padding:'32px 16px',fontSize:'12px'}}>Tidak ada item</div>}
            </div>
          </div>

          {/* Right: detail */}
          <div className={styles.dashRight}>
            {!selectedItem ? (
              <div className={styles.dashEmpty}>
                <div className={styles.dashEmptyIcon}>🔍</div>
                <div>Pilih item di kiri untuk melihat perbandingan BPB/R.j vs ADJ(-)</div>
                <div style={{fontSize:'12px',color:'var(--text3)',marginTop:'8px',textAlign:'center',maxWidth:'300px'}}>
                  <span style={{color:'var(--danger)'}}>⚠ Tidak Ada ADJ(-)</span> = BPB/R.j ada tapi tidak ada input BS — mencurigakan<br/>
                  <span style={{color:'var(--accent)'}}>✓ Keduanya</span> = Ada BPB/R.j dan ADJ(-) — perlu cek timeline<br/>
                  <span style={{color:'var(--warn)'}}>ADJ Only</span> = ADJ(-) ada tapi tidak ada BPB/R.j
                </div>
              </div>
            ) : (
              <>
                <div className={styles.custDetailHeader}>
                  <div>
                    <div className={styles.custDetailKode} style={{color: selectedItem.status==='NO_ADJ'?'var(--danger)':selectedItem.status==='BOTH'?'var(--accent)':selectedItem.status==='BATAL_ONLY'?'var(--text3)':'var(--warn)'}}>
                      {selectedItem.status==='NO_ADJ'?'⚠':selectedItem.status==='BOTH'?'✓':selectedItem.status==='BATAL_ONLY'?'⊘':'📋'} {selectedItem.kodeBarang}
                    </div>
                    <div className={styles.custDetailSub}>{selectedItem.deskripsi} · {selectedItem.unit}</div>
                  </div>
                </div>

                {/* Stats */}
                <div className={styles.custDetailStats}>
                  <div className={styles.modalStat}><span className={styles.modalStatLabel}>BPB/R.j</span><span className={`${styles.modalStatVal} ${styles.colWarn}`}>{selectedItem.bpbRjList.length}</span></div>
                  <div className={styles.modalStat}><span className={styles.modalStatLabel}>ADJ(-)</span><span className={`${styles.modalStatVal} ${selectedItem.adjMinList.length>0?styles.colIn:styles.colDanger}`}>{selectedItem.adjMinList.length}</span></div>
                  <div className={styles.modalStat}>
                    <span className={styles.modalStatLabel}>Status</span>
                    <span className={`${styles.modalStatVal}`} style={{fontSize:'13px',color:selectedItem.status==='NO_ADJ'?'var(--danger)':selectedItem.status==='BOTH'?'var(--accent)':selectedItem.status==='BATAL_ONLY'?'var(--text3)':'var(--warn)'}}>
                      {selectedItem.status==='NO_ADJ'?'⚠ Tidak ada ADJ(-)':selectedItem.status==='BOTH'?'✓ Ada keduanya':selectedItem.status==='BATAL_ONLY'?'⊘ Semua batal/ganti barang':'ADJ(-) tanpa BPB/R.j'}
                    </span>
                  </div>
                </div>

                {/* Chart comparison */}
                {buildCompareChart(selectedItem).length > 0 && (
                  <div className={styles.chartSection} style={{flexDirection:'column',padding:'16px 20px',gap:'8px'}}>
                    <div className={styles.chartTitle}>Frekuensi per Bulan</div>
                    <div style={{display:'flex',gap:'16px',alignItems:'flex-end'}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:'10px',color:'var(--warn)',fontFamily:'var(--font-mono)',marginBottom:'4px'}}>BPB/R.j</div>
                        <div className={styles.chartWrap} style={{height:'60px'}}>
                          {buildCompareChart(selectedItem).map((d,i) => {
                            const max = Math.max(...buildCompareChart(selectedItem).map(x=>x.bpb),1)
                            return <div key={i} className={styles.chartCol} title={`${d.label}: ${d.bpb} BPB/R.j`}>
                              <div className={styles.chartBar} style={{height:`${Math.max(2,(d.bpb/max)*100)}%`,background:'var(--warn)'}} />
                              <div className={styles.chartLabel}>{d.label.split('/')[0]}</div>
                            </div>
                          })}
                        </div>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:'10px',color:'var(--accent)',fontFamily:'var(--font-mono)',marginBottom:'4px'}}>ADJ(-)</div>
                        <div className={styles.chartWrap} style={{height:'60px'}}>
                          {buildCompareChart(selectedItem).map((d,i) => {
                            const max = Math.max(...buildCompareChart(selectedItem).map(x=>x.adj),1)
                            return <div key={i} className={styles.chartCol} title={`${d.label}: ${d.adj} ADJ(-)`}>
                              <div className={styles.chartBar} style={{height:`${Math.max(2,(d.adj/max)*100)}%`,background:'var(--accent)'}} />
                              <div className={styles.chartLabel}>{d.label.split('/')[0]}</div>
                            </div>
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Timeline */}
                {/* SO Harian section */}
                {soMap && (
                  <div className={styles.soSection}>
                    <div className={styles.chartTitle} style={{padding:'12px 20px 0'}}>📋 History SO Harian — {selectedItem.kodeBarang}</div>
                    {(soMap[selectedItem.kodeBarang]||[]).length === 0 ? (
                      <div className={styles.soEmpty}>Tidak ada data SO untuk item ini</div>
                    ) : (
                      <table className={styles.modalTable}>
                        <thead><tr>
                          <th className={styles.mth}>No SO</th><th className={styles.mth}>Tanggal</th>
                          <th className={styles.mth}>S1</th><th className={styles.mth}>S2</th>
                          <th className={`${styles.mth} ${styles.alignRight}`}>Q Fisik</th>
                          <th className={`${styles.mth} ${styles.alignRight}`}>Q Sistem</th>
                          <th className={`${styles.mth} ${styles.alignRight}`}>Selisih</th>
                          <th className={styles.mth}>KET</th><th className={styles.mth}>Catatan</th>
                        </tr></thead>
                        <tbody>
                          {(soMap[selectedItem.kodeBarang]||[]).map((so,i)=>(
                            <tr key={i} className={`${styles.mtr} ${so.ket==='KRG'?styles.mtrLambat:so.ket==='LBH'?styles.mtrBpbRj:''}`}>
                              <td className={`${styles.mtd} ${styles.tdNoTx}`}>{so.nomor}</td>
                              <td className={`${styles.mtd} ${styles.tdDate}`}>{so.tanggal}</td>
                              <td className={`${styles.mtd}`} style={{color:so.s1==='AV'?'var(--accent)':'var(--danger)'}}>{so.s1}</td>
                              <td className={`${styles.mtd}`} style={{color:so.s2==='AV'?'var(--accent)':'var(--danger)'}}>{so.s2}</td>
                              <td className={`${styles.mtd} ${styles.alignRight}`}>{so.qHas.toLocaleString('id-ID')}</td>
                              <td className={`${styles.mtd} ${styles.alignRight}`}>{so.qtyS.toLocaleString('id-ID')}</td>
                              <td className={`${styles.mtd} ${styles.alignRight} ${so.qSel<0?styles.colOut:so.qSel>0?styles.colIn:styles.colMuted}`}>{so.qSel>0?'+':''}{so.qSel.toLocaleString('id-ID')}</td>
                              <td className={styles.mtd}>
                                {so.ket==='PAS'&&<span className={styles.badgeOk}>PAS</span>}
                                {so.ket==='KRG'&&<span className={styles.badgeDanger}>KRG</span>}
                                {so.ket==='LBH'&&<span className={styles.badgeWarn}>LBH</span>}
                              </td>
                              <td className={`${styles.mtd} ${styles.tdDescTx}`}>{so.catatan||'—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                <div className={styles.custTxWrap}>
                  <div className={styles.timelineHeader}>
                    <span className={styles.tlLegend}><span className={styles.tlDotBpb} />BPB/R.j (Retur/Rusak dari customer)</span>
                    <span className={styles.tlLegend}><span className={styles.tlDotAdj} />ADJ(-) (Admin input Bad Stock)</span>
                  </div>
                  <table className={styles.modalTable}>
                    <thead>
                      <tr>
                        <th className={styles.mth}>Tipe</th>
                        <th className={styles.mth}>Tgl</th>
                        <th className={styles.mth}>No Transaksi</th>
                        <th className={styles.mth}>Cust/Supp</th>
                        <th className={styles.mth}>No Reff</th>
                        <th className={`${styles.mth} ${styles.alignRight}`}>QTY OUT</th>
                        <th className={`${styles.mth} ${styles.alignRight}`}>QTY IN</th>
                        <th className={styles.mth}>User ADM</th>
                        <th className={styles.mth}>Tgl Input</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buildTimeline(selectedItem).map((e, i) => (
                        <tr key={i} className={`${styles.mtr} ${e.kind==='bpb'?styles.mtrBpbRj:styles.mtrAdj}`}>
                          <td className={styles.mtd}>
                            {e.kind==='bpb'
                              ? (e.batal ? <span className={styles.tlBadgeBatal}>BPB/R.j ⊘ Batal</span> : <span className={styles.tlBadgeBpb}>BPB/R.j</span>)
                              : <span className={styles.tlBadgeAdj}>ADJ(-)</span>}
                          </td>
                          <td className={`${styles.mtd} ${styles.tdDate}`}>{e.tglPO}</td>
                          <td className={`${styles.mtd} ${styles.tdNoTx}`}>{e.noTx||'—'}</td>
                          <td className={`${styles.mtd} ${styles.tdCust}`}>{e.kodeCust||'—'}</td>
                          <td className={`${styles.mtd} ${styles.tdReff}`}>{e.noReff||'—'}</td>
                          <td className={`${styles.mtd} ${styles.alignRight} ${e.qtyOut>0?styles.colOut:styles.colMuted}`}>{e.qtyOut>0?fmt(e.qtyOut):'—'}</td>
                          <td className={`${styles.mtd} ${styles.alignRight} ${e.qtyIn>0?styles.colIn:styles.colMuted}`}>{e.qtyIn>0?fmt(e.qtyIn):'—'}</td>
                          <td className={`${styles.mtd} ${styles.tdAdmUser}`}>{e.admUser||'—'}</td>
                          <td className={`${styles.mtd} ${styles.tdAdmDate}`}>{e.admTanggal||'—'}</td>
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

// ── BPB/R.j Customer Dashboard ───────────────────────────────────────────────
function BpbRjDashboard({ rows, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const [selectedCust, setSelectedCust] = useState(null)
  const [sortBy, setSortBy] = useState('count')

  const custMap = {}
  for (const r of rows) {
    const c = r.kodeCust || '(kosong)'
    if (!custMap[c]) custMap[c] = { kodeCust: c, count: 0, batalCount: 0, totalOut: 0, totalIn: 0, transactions: [] }
    custMap[c].count++; custMap[c].totalOut += r.qtyOut||0; custMap[c].totalIn += r.qtyIn||0
    if (r.batal) custMap[c].batalCount++
    custMap[c].transactions.push(r)
  }
  const custList = Object.values(custMap).sort((a,b)=>sortBy==='count'?b.count-a.count:b.totalOut-a.totalOut)
  const selected = selectedCust ? custMap[selectedCust] : null

  const buildChart = (txs) => {
    const mm = {}
    for (const t of txs) { const p=t.tglPO.split('/'); const k=`${p[1]}/${p[2]?.slice(2)}`; if(!mm[k])mm[k]=0; mm[k]+=t.qtyOut||0 }
    return Object.entries(mm).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>({label:k,shortLabel:k.split('/')[0],value:v}))
  }

  const buildItemChart = (txs) => {
    const im = {}
    for (const t of txs) { const k=t.kodeBarang; if(!im[k])im[k]={kode:k,desc:t.deskripsi,out:0,count:0}; im[k].out+=t.qtyOut||0; im[k].count++ }
    return Object.values(im).sort((a,b)=>b.out-a.out).slice(0,10)
  }

  const exportCust = async (cust) => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(cust.transactions.map(r=>({'Kode Barang':r.kodeBarang,'Deskripsi':r.deskripsi,'Unit':r.unit,'Tgl PO':r.tglPO,'No Transaksi':r.noTx,'Cust/Supp':r.kodeCust,'No Reff':r.noReff,'QTY OUT':r.qtyOut||0,'QTY IN':r.qtyIn||0,'Saldo':r.saldo,'User ADM':r.admUser,'Tgl Input':r.admTanggal,'Status':r.batal?'Batal/Ganti Barang':'Aktif'})))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,`BPB-RJ ${cust.kodeCust}`)
    XLSX.writeFile(wb,`bpb_rj_${cust.kodeCust}_${Date.now()}.xlsx`)
  }

  const exportAll = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(custList.map(c=>({'Kode Customer':c.kodeCust,'Jumlah BPB/R.j':c.count,'Total QTY OUT':c.totalOut,'Total QTY IN':c.totalIn}))),'Summary per Customer')
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.map(r=>({'Kode Barang':r.kodeBarang,'Deskripsi':r.deskripsi,'Unit':r.unit,'Tgl PO':r.tglPO,'No Transaksi':r.noTx,'Cust/Supp':r.kodeCust,'No Reff':r.noReff,'QTY OUT':r.qtyOut||0,'QTY IN':r.qtyIn||0,'Saldo':r.saldo,'User ADM':r.admUser,'Tgl Input':r.admTanggal,'Status':r.batal?'Batal/Ganti Barang':'Aktif'}))),'Semua BPB-RJ')
    XLSX.writeFile(wb,`bpb_rj_dashboard_${Date.now()}.xlsx`)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dashModal} onClick={e=>e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div><div className={styles.modalKode} style={{color:'var(--warn)'}}>📦 Dashboard BPB/R.j — Analisis Customer</div><div className={styles.modalDesc}>{rows.length} transaksi · {custList.length} customer</div></div>
          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            <button className={styles.btnExportSmall} onClick={exportAll}>↓ Export Semua</button>
            <button className={styles.modalClose} onClick={onClose}>✕</button>
          </div>
        </div>
        <div className={styles.dashBody}>
          <div className={styles.dashLeft}>
            <div className={styles.dashLeftHeader}>
              <span className={styles.dashLeftTitle}>Customer</span>
              <div className={styles.sortToggle}>
                <button className={`${styles.sortBtn} ${sortBy==='count'?styles.sortBtnActive:''}`} onClick={()=>setSortBy('count')}>Frekuensi</button>
                <button className={`${styles.sortBtn} ${sortBy==='out'?styles.sortBtnActive:''}`} onClick={()=>setSortBy('out')}>QTY</button>
              </div>
            </div>
            <div className={styles.custList}>
              {custList.map((c,i)=>(
                <div key={c.kodeCust} className={`${styles.custCard} ${selectedCust===c.kodeCust?styles.custCardActive:''} ${c.count>=5?styles.custCardHigh:c.count>=3?styles.custCardMed:''}`} onClick={()=>setSelectedCust(c.kodeCust)}>
                  <div className={styles.custCardTop}>
                    <div className={styles.custRank}>#{i+1}</div>
                    <div className={styles.custKode}>{c.kodeCust}</div>
                    {c.count>=5&&<span className={styles.badgeDanger}>⚠ Sering</span>}
                    {c.count>=3&&c.count<5&&<span className={styles.badgeWarn}>Perhatian</span>}
                  </div>
                  <div className={styles.custCardStats}>
                    <span className={styles.custStat}><span className={styles.custStatNum}>{c.count}</span>x{c.batalCount>0&&<span style={{color:'var(--text3)'}}> ({c.batalCount} batal)</span>}</span>
                    <span className={styles.custStat}><span className={`${styles.custStatNum} ${styles.colOut}`}>{c.totalOut.toLocaleString('id-ID')}</span> OUT</span>
                    {c.totalIn>0&&<span className={styles.custStat}><span className={`${styles.custStatNum} ${styles.colIn}`}>{c.totalIn.toLocaleString('id-ID')}</span> IN</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.dashRight}>
            {!selected?(
              <div className={styles.dashEmpty}><div className={styles.dashEmptyIcon}>👈</div><div>Pilih customer untuk lihat detail history BPB/R.j</div></div>
            ):(
              <>
                <div className={styles.custDetailHeader}>
                  <div><div className={styles.custDetailKode}>{selected.kodeCust}</div><div className={styles.custDetailSub}>{selected.count} transaksi BPB/R.j</div></div>
                  <button className={styles.btnExportSmall} onClick={()=>exportCust(selected)}>↓ Export</button>
                </div>
                <div className={styles.custDetailStats}>
                  <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total BPB/R.j</span><span className={`${styles.modalStatVal} ${styles.colWarn}`}>{selected.count}</span></div>
                  <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total QTY OUT</span><span className={`${styles.modalStatVal} ${styles.colOut}`}>{selected.totalOut.toLocaleString('id-ID')}</span></div>
                  {selected.totalIn>0&&<div className={styles.modalStat}><span className={styles.modalStatLabel}>Total QTY IN</span><span className={`${styles.modalStatVal} ${styles.colIn}`}>{selected.totalIn.toLocaleString('id-ID')}</span></div>}
                  <div className={styles.modalStat}><span className={styles.modalStatLabel}>Item Berbeda</span><span className={styles.modalStatVal}>{new Set(selected.transactions.map(t=>t.kodeBarang)).size}</span></div>
                </div>
                <div className={styles.chartSection}>
                  <div className={styles.chartBox}>
                    <div className={styles.chartTitle}>QTY OUT per Bulan</div>
                    <MiniBarChart data={buildChart(selected.transactions)} />
                  </div>
                  <div className={styles.chartBox}>
                    <div className={styles.chartTitle}>Top Barang (QTY OUT)</div>
                    <div className={styles.itemBars}>
                      {buildItemChart(selected.transactions).map((item,i)=>{
                        const max=Math.max(...buildItemChart(selected.transactions).map(x=>x.out),1)
                        return(<div key={i} className={styles.itemBar}><div className={styles.itemBarLabel} title={item.desc}>{item.kode}</div><div className={styles.itemBarTrack}><div className={styles.itemBarFill} style={{width:`${Math.max(4,(item.out/max)*100)}%`}} /></div><div className={styles.itemBarVal}>{item.out.toLocaleString('id-ID')} <span className={styles.itemBarCount}>({item.count}x)</span></div></div>)
                      })}
                    </div>
                  </div>
                </div>
                <div className={styles.custTxWrap}>
                  <table className={styles.modalTable}>
                    <thead><tr>
                      <th className={styles.mth}>#</th><th className={styles.mth}>Tgl PO</th><th className={styles.mth}>Kode Barang</th>
                      <th className={styles.mth}>Deskripsi</th><th className={styles.mth}>No Transaksi</th><th className={styles.mth}>No Reff</th>
                      <th className={`${styles.mth} ${styles.alignRight}`}>QTY OUT</th><th className={`${styles.mth} ${styles.alignRight}`}>QTY IN</th>
                      <th className={styles.mth}>User ADM</th><th className={styles.mth}>Tgl Input</th>
                    </tr></thead>
                    <tbody>
                      {selected.transactions.sort((a,b)=>a.tglPO.split('/').reverse().join('').localeCompare(b.tglPO.split('/').reverse().join(''))).map((r,i)=>(
                        <tr key={i} className={`${styles.mtr} ${styles.mtrBpbRj}`}>
                          <td className={`${styles.mtd} ${styles.tdNum}`}>{i+1}</td>
                          <td className={`${styles.mtd} ${styles.tdDate}`}>{r.tglPO}</td>
                          <td className={`${styles.mtd} ${styles.tdAdmUser}`}>{r.kodeBarang}</td>
                          <td className={`${styles.mtd} ${styles.tdDescTx}`}>{r.deskripsi}</td>
                          <td className={`${styles.mtd} ${styles.tdNoTx}`}>{r.noTx} {r.batal&&<span className={styles.badgeMuted}>⊘ Batal</span>}</td>
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
  useEffect(()=>{const h=(e)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h)},[onClose])
  const txs=item.transactions||[]
  const totalIn=txs.reduce((s,t)=>s+(t.in||0),0), totalOut=txs.reduce((s,t)=>s+(t.out||0),0)
  const lambatCount=txs.filter(t=>t.isLambat).length, bpbRjCount=txs.filter(t=>t.isBpbRj).length
  return(
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
                  return(<tr key={i} className={[styles.mtr,t.isBpbRj?styles.mtrBpbRj:t.in>0?styles.mtrIn:t.out>0?styles.mtrOut:'',t.isLambat?styles.mtrLambat:''].join(' ')}>
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
                  </tr>)
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
  useEffect(()=>{const h=(e)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h)},[onClose])
  const exportLambat=async()=>{const XLSX=await import('xlsx');const ws=XLSX.utils.json_to_sheet(rows.map(r=>({'Kode Barang':r.kodeBarang,'Deskripsi':r.deskripsi,'Unit':r.unit,'Tgl PO':r.tglPO,'Waktu':r.waktu,'No Transaksi':r.noTx,'Jenis':r.jenisTrs,'Cust/Supp':r.kodeCust,'No Reff':r.noReff,'Type':r.type,'QTY IN':r.qty,'Saldo':r.saldo,'User ADM':r.admUser,'Tgl Input ADM':r.admTanggal,'Selisih Hari':r.selisihHari===2&&r.hasWeekend?'H+2 (Weekend)':`H+${r.selisihHari}`})));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Beli nkl Lambat');XLSX.writeFile(wb,`beli_nkl_lambat_${Date.now()}.xlsx`)}
  return(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e=>e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div><div className={styles.modalKode} style={{color:'var(--danger)'}}>⚠ Beli nkl — Input Terlambat</div><div className={styles.modalDesc}>Selisih Tgl PO vs Tgl Input ADM ≥ H+2</div></div>
          <div style={{display:'flex',gap:'8px',alignItems:'center'}}><button className={styles.btnExportSmall} onClick={exportLambat}>↓ Export Excel</button><button className={styles.modalClose} onClick={onClose}>✕</button></div>
        </div>
        <div className={styles.modalStats}>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total</span><span className={`${styles.modalStatVal} ${styles.colDanger}`}>{rows.length}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>H+2 Weekend 🏖</span><span className={`${styles.modalStatVal} ${styles.colWarn}`}>{rows.filter(r=>r.selisihHari===2&&r.hasWeekend).length}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>H+2 Terlambat</span><span className={`${styles.modalStatVal} ${styles.colDanger}`}>{rows.filter(r=>r.selisihHari===2&&!r.hasWeekend).length}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>H+3 ke atas ⚠</span><span className={`${styles.modalStatVal} ${styles.colDanger}`}>{rows.filter(r=>r.selisihHari>=3).length}</span></div>
          <div className={styles.modalStat}><span className={styles.modalStatLabel}>Total QTY</span><span className={styles.modalStatVal}>{rows.reduce((s,r)=>s+(r.qty||0),0).toLocaleString('id-ID')}</span></div>
        </div>
        <div className={styles.modalTableWrap}>
          {rows.length===0?<div className={styles.modalEmpty}>Tidak ada ✓</div>:(
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
                    <td className={`${styles.mtd} ${styles.tdNum}`}>{i+1}</td><td className={`${styles.mtd} ${styles.tdAdmUser}`}>{r.kodeBarang}</td>
                    <td className={`${styles.mtd} ${styles.tdDescTx}`}>{r.deskripsi}</td><td className={`${styles.mtd} ${styles.tdDate}`}>{r.tglPO}</td>
                    <td className={`${styles.mtd} ${styles.tdNoTx}`}>{r.noTx}</td><td className={`${styles.mtd} ${styles.tdCust}`}>{r.kodeCust}</td>
                    <td className={`${styles.mtd} ${styles.tdReff}`}>{r.noReff}</td><td className={`${styles.mtd} ${styles.alignRight} ${styles.colIn}`}>{fmt(r.qty)}</td>
                    <td className={`${styles.mtd} ${styles.tdAdmUser}`}>{r.admUser}</td><td className={`${styles.mtd} ${styles.tdAdmDate}`}>{r.admTanggal}</td>
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
  const [pwInput,setPwInput]=useState(''); const [pwError,setPwError]=useState(false)
  const handleLogin=()=>{if(pwInput===PASSWORD){sessionStorage.setItem('stok_auth','1');setAuthed(true);setPwError(false)}else{setPwError(true);setPwInput('')}}
  const [data,setData]=useState(null); const [fileName,setFileName]=useState(null)
  const [cleanKode,setCleanKode]=useState(true); const [loading,setLoading]=useState(false)
  const [dragging,setDragging]=useState(false); const [search,setSearch]=useState('')
  const [sortKey,setSortKey]=useState(null); const [sortDir,setSortDir]=useState('asc')
  const [selectedItem,setSelectedItem]=useState(null)
  const [showLambat,setShowLambat]=useState(false)
  const [showBpbRj,setShowBpbRj]=useState(false)
  const [showAdj,setShowAdj]=useState(false)
  const [soData,setSoData]=useState(null)
  const [soFileName,setSoFileName]=useState(null)
  const fileRef=useRef()
  const soFileRef=useRef()

  const processSOFile=useCallback((file)=>{
    if(!file||!file.name.toLowerCase().endsWith('.csv')){alert('Harap upload file .csv untuk SO Harian');return}
    setSoFileName(file.name)
    const reader=new FileReader()
    reader.onload=(e)=>{try{setSoData(parseSOCsv(e.target.result,cleanKode))}catch(err){alert('Error SO: '+err.message)}}
    reader.readAsText(file,'utf-8')
  },[cleanKode])

  const processFile=useCallback((file)=>{
    if(!file||!file.name.endsWith('.txt')){alert('Harap upload file .txt');return}
    setLoading(true);setFileName(file.name)
    const reader=new FileReader()
    reader.onload=(e)=>{try{setData(processTextToDf(e.target.result,cleanKode))}catch(err){alert('Error: '+err.message)};setLoading(false)}
    reader.readAsText(file,'utf-8')
  },[cleanKode])

  const handleDrop=useCallback((e)=>{e.preventDefault();setDragging(false);processFile(e.dataTransfer.files[0])},[processFile])
  const handleSort=(key)=>{if(sortKey===key)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortKey(key);setSortDir('asc')}}
  const exportExcel=async()=>{if(!data)return;const XLSX=await import('xlsx');const ws=XLSX.utils.json_to_sheet(data.map(r=>({'Kode Barang':r.kodeBarang,'Deskripsi':r.deskripsi,'Unit':r.unit,'Saldo Awal':r.saldoAwal,'Total IN':r.totalIn,'Total OUT':r.totalOut,'Saldo Akhir':r.saldoAkhir,'Has Transactions':r.hasTx?'Ya':'Tidak'})));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Kartu Stok');XLSX.writeFile(wb,`kartu_stok_rule2_${Date.now()}.xlsx`)}

  const lambatRows=data?getBeliNklLambat(data):[]
  const bpbRjRows=data?getBpbRj(data):[]
  const adjAnalysis=data?getAdjAnalysis(data):[]
  const adjNoMatch=adjAnalysis.filter(r=>r.status==='NO_ADJ')

  const filteredData=data?data.filter(r=>!search||r.kodeBarang.toLowerCase().includes(search.toLowerCase())||r.deskripsi.toLowerCase().includes(search.toLowerCase())):[]
  const sortedData=sortKey?[...filteredData].sort((a,b)=>{const av=a[sortKey]??'';const bv=b[sortKey]??'';const cmp=av<bv?-1:av>bv?1:0;return sortDir==='asc'?cmp:-cmp}):filteredData
  const stats=data?{items:data.length,totalIn:data.reduce((s,r)=>s+(r.totalIn||0),0),totalOut:data.reduce((s,r)=>s+(r.totalOut||0),0),withTx:data.filter(r=>r.hasTx).length}:null

  if(!authed)return(
    <div className={styles.loginPage}>
      <div className={styles.loginBox}>
        <div className={styles.loginIcon}>▣</div><div className={styles.loginTitle}>Kartu Stok</div><div className={styles.loginSub}>Rule 2 Processor</div>
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
              {adjAnalysis.length>0&&<button className={styles.btnAdj} onClick={()=>setShowAdj(true)}>🔍 ADJ vs BPB/R.j {adjNoMatch.length>0&&`(${adjNoMatch.length} ⚠)`}</button>}
              {bpbRjRows.length>0&&<button className={styles.btnBpbRj} onClick={()=>setShowBpbRj(true)}>📦 BPB/R.j ({bpbRjRows.length})</button>}
              {lambatRows.length>0&&<button className={styles.btnLambat} onClick={()=>setShowLambat(true)}>⚠ Input Lambat ({lambatRows.length})</button>}
              <button className={styles.btnExport} onClick={exportExcel}>↓ Export Excel</button>
            </>}
          </div>
        </div>
      </header>
      <main className={styles.main}>
        {!data&&(<div className={`${styles.dropzone} ${dragging?styles.dropzoneActive:''}`} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={handleDrop} onClick={()=>fileRef.current.click()}>
          <input ref={fileRef} type="file" accept=".txt" style={{display:'none'}} onChange={e=>processFile(e.target.files[0])} />
          <div className={styles.dropIcon}>⬆</div><div className={styles.dropTitle}>{loading?'Memproses...':'Upload File TXT'}</div>
          <div className={styles.dropSub}>Drag & drop atau klik untuk memilih file</div><div className={styles.dropHint}>.txt — Kartu Stok format</div>
        </div>)}
        {data&&(<div className={styles.controlBar}>
          <div className={styles.fileTag}><span className={styles.fileTagIcon}>▣</span>{fileName}</div>
          <label className={styles.toggle}><input type="checkbox" checked={cleanKode} onChange={e=>setCleanKode(e.target.checked)} /><span className={styles.toggleTrack} /><span className={styles.toggleLabel}>Clean Kode Barang</span></label>
          <button className={styles.btnReupload} onClick={()=>{setData(null);setFileName(null);setSearch('')}}>↺ Ganti File</button>
          <input ref={soFileRef} type="file" accept=".csv" style={{display:'none'}} onChange={e=>processSOFile(e.target.files[0])} />
          {!soData
            ? <button className={styles.btnSO} onClick={()=>soFileRef.current.click()}>+ Upload SO Harian (CSV)</button>
            : <div className={styles.fileTag} style={{borderColor:'rgba(64,196,255,0.4)'}}><span style={{color:'var(--info)'}}>📋</span>{soFileName} · {soData.length} SO<button className={styles.soRemove} onClick={()=>{setSoData(null);setSoFileName(null)}}>✕</button></div>}
          <div className={styles.clickHint}>💡 Klik baris untuk lihat detail transaksi</div>
        </div>)}
        {stats&&(<div className={styles.stats}>
          <div className={styles.stat}><div className={styles.statVal}>{stats.items.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Total Item</div></div>
          <div className={styles.stat}><div className={`${styles.statVal} ${styles.statIn}`}>{stats.totalIn.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Total IN</div></div>
          <div className={styles.stat}><div className={`${styles.statVal} ${styles.statOut}`}>{stats.totalOut.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Total OUT</div></div>
          <div className={styles.stat}><div className={styles.statVal}>{stats.withTx.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Punya Transaksi</div></div>
          {adjNoMatch.length>0&&<div className={`${styles.stat} ${styles.statDanger}`} style={{cursor:'pointer'}} onClick={()=>setShowAdj(true)}><div className={`${styles.statVal} ${styles.statRed}`}>{adjNoMatch.length}</div><div className={styles.statLabel}>BPB/R.j tanpa ADJ 🔍</div></div>}
          {bpbRjRows.length>0&&<div className={`${styles.stat} ${styles.statWarn}`} style={{cursor:'pointer'}} onClick={()=>setShowBpbRj(true)}><div className={`${styles.statVal} ${styles.colWarn}`}>{bpbRjRows.length}</div><div className={styles.statLabel}>BPB/R.j 📦</div></div>}
          {lambatRows.length>0&&<div className={`${styles.stat} ${styles.statDanger}`} style={{cursor:'pointer'}} onClick={()=>setShowLambat(true)}><div className={`${styles.statVal} ${styles.statRed}`}>{lambatRows.length}</div><div className={styles.statLabel}>Input Lambat ⚠</div></div>}
          {search&&<div className={styles.stat}><div className={styles.statVal}>{sortedData.length.toLocaleString('id-ID')}</div><div className={styles.statLabel}>Hasil Filter</div></div>}
        </div>)}
        {data&&(<div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr>{COLS.map(col=><th key={col.key} className={`${styles.th} ${styles['align_'+col.align]}`} onClick={()=>handleSort(col.key)}>{col.label}{sortKey===col.key&&<span className={styles.sortArrow}>{sortDir==='asc'?' ↑':' ↓'}</span>}</th>)}</tr></thead>
            <tbody>
              {sortedData.map((row,i)=>{
                const hasLambat=row.transactions?.some(t=>t.isLambat), hasBpbRj=row.transactions?.some(t=>t.isBpbRj)
                return(<tr key={i} className={[styles.tr,hasLambat?styles.trLambat:'',hasBpbRj&&!hasLambat?styles.trBpbRj:''].join(' ')} onClick={()=>setSelectedItem(row)} title="Klik untuk lihat transaksi">
                  {COLS.map(col=>(<td key={col.key} className={[styles.td,styles['align_'+col.align],col.color==='in'?styles.tdIn:'',col.color==='out'?styles.tdOut:'',col.color==='saldo'?styles.tdSaldo:'',col.key==='hasTx'?(row[col.key]?styles.tdYes:styles.tdNo):'',col.key==='kodeBarang'?styles.tdKode:''].join(' ')}>
                    {col.key==='kodeBarang'?<>{fmt(row[col.key])}{hasLambat&&<span className={styles.lambatDot} title="Ada input lambat"> ●</span>}{hasBpbRj&&<span className={styles.bpbDot} title="Ada BPB/R.j"> ◆</span>}</>:fmt(row[col.key])}
                  </td>))}
                </tr>)
              })}
            </tbody>
          </table>
          {sortedData.length===0&&<div className={styles.empty}>Tidak ada hasil untuk "{search}"</div>}
        </div>)}
      </main>
      <footer className={styles.footer}>Kartu Stok Rule 2 Processor — running saldo method</footer>
      {selectedItem&&<TransactionModal item={selectedItem} onClose={()=>setSelectedItem(null)} />}
      {showLambat&&<LambatModal rows={lambatRows} onClose={()=>setShowLambat(false)} />}
      {showBpbRj&&<BpbRjDashboard rows={bpbRjRows} onClose={()=>setShowBpbRj(false)} />}
      {showAdj&&<AdjDashboard analysis={adjAnalysis} soMap={soData?groupSOByKode(soData):null} onClose={()=>setShowAdj(false)} />}
    </div>
  )
}
