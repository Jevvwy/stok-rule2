'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { processTextToDf } from './parser'
import styles from './page.module.css'

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

function TransactionModal({ item, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const txs = item.transactions || []
  const totalIn = txs.reduce((s, t) => s + (t.in || 0), 0)
  const totalOut = txs.reduce((s, t) => s + (t.out || 0), 0)

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Modal header */}
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalKode}>{item.kodeBarang}</div>
            <div className={styles.modalDesc}>{item.deskripsi}</div>
          </div>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        {/* Summary pills */}
        <div className={styles.modalStats}>
          <div className={styles.modalStat}>
            <span className={styles.modalStatLabel}>Saldo Awal</span>
            <span className={styles.modalStatVal}>{fmt(item.saldoAwal)}</span>
          </div>
          <div className={styles.modalStat}>
            <span className={styles.modalStatLabel}>Total IN</span>
            <span className={`${styles.modalStatVal} ${styles.colIn}`}>{fmt(totalIn)}</span>
          </div>
          <div className={styles.modalStat}>
            <span className={styles.modalStatLabel}>Total OUT</span>
            <span className={`${styles.modalStatVal} ${styles.colOut}`}>{fmt(totalOut)}</span>
          </div>
          <div className={styles.modalStat}>
            <span className={styles.modalStatLabel}>Saldo Akhir</span>
            <span className={`${styles.modalStatVal} ${styles.colSaldo}`}>{fmt(item.saldoAkhir)}</span>
          </div>
          <div className={styles.modalStat}>
            <span className={styles.modalStatLabel}>Unit</span>
            <span className={styles.modalStatVal}>{item.unit || '—'}</span>
          </div>
        </div>

        {/* Transaction table */}
        <div className={styles.modalTableWrap}>
          {txs.length === 0 ? (
            <div className={styles.modalEmpty}>Tidak ada transaksi untuk item ini</div>
          ) : (
            <table className={styles.modalTable}>
              <thead>
                <tr>
                  <th className={styles.mth}>#</th>
                  <th className={styles.mth}>Tanggal</th>
                  <th className={styles.mth}>Keterangan</th>
                  <th className={`${styles.mth} ${styles.alignRight}`}>IN</th>
                  <th className={`${styles.mth} ${styles.alignRight}`}>OUT</th>
                  <th className={`${styles.mth} ${styles.alignRight}`}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t, i) => (
                  <tr key={i} className={styles.mtr}>
                    <td className={`${styles.mtd} ${styles.tdNum}`}>{i + 1}</td>
                    <td className={`${styles.mtd} ${styles.tdDate}`}>{t.date}</td>
                    <td className={`${styles.mtd} ${styles.tdDescTx}`}>{t.desc || '—'}</td>
                    <td className={`${styles.mtd} ${styles.alignRight} ${t.in > 0 ? styles.colIn : styles.colMuted}`}>
                      {t.in > 0 ? fmt(t.in) : '—'}
                    </td>
                    <td className={`${styles.mtd} ${styles.alignRight} ${t.out > 0 ? styles.colOut : styles.colMuted}`}>
                      {t.out > 0 ? fmt(t.out) : '—'}
                    </td>
                    <td className={`${styles.mtd} ${styles.alignRight} ${styles.colSaldo}`}>
                      {fmt(t.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [data, setData] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [cleanKode, setCleanKode] = useState(true)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [selectedItem, setSelectedItem] = useState(null)
  const fileRef = useRef()

  const processFile = useCallback((file) => {
    if (!file || !file.name.endsWith('.txt')) {
      alert('Harap upload file .txt')
      return
    }
    setLoading(true)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const result = processTextToDf(e.target.result, cleanKode)
        setData(result)
      } catch (err) {
        alert('Error memproses file: ' + err.message)
      }
      setLoading(false)
    }
    reader.readAsText(file, 'utf-8')
  }, [cleanKode])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    processFile(e.dataTransfer.files[0])
  }, [processFile])

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const exportExcel = async () => {
    if (!data) return
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(data.map(r => ({
      'Kode Barang': r.kodeBarang,
      'Deskripsi': r.deskripsi,
      'Unit': r.unit,
      'Saldo Awal': r.saldoAwal,
      'Total IN': r.totalIn,
      'Total OUT': r.totalOut,
      'Saldo Akhir': r.saldoAkhir,
      'Has Transactions': r.hasTx ? 'Ya' : 'Tidak',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Kartu Stok')
    XLSX.writeFile(wb, `kartu_stok_rule2_${Date.now()}.xlsx`)
  }

  const filteredData = data
    ? data.filter(r =>
        !search ||
        r.kodeBarang.toLowerCase().includes(search.toLowerCase()) ||
        r.deskripsi.toLowerCase().includes(search.toLowerCase())
      )
    : []

  const sortedData = sortKey
    ? [...filteredData].sort((a, b) => {
        const av = a[sortKey] ?? ''
        const bv = b[sortKey] ?? ''
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    : filteredData

  const stats = data ? {
    items: data.length,
    totalIn: data.reduce((s, r) => s + (r.totalIn || 0), 0),
    totalOut: data.reduce((s, r) => s + (r.totalOut || 0), 0),
    withTx: data.filter(r => r.hasTx).length,
  } : null

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>▣</span>
            <div>
              <div className={styles.brandTitle}>Kartu Stok</div>
              <div className={styles.brandSub}>Rule 2 Processor</div>
            </div>
          </div>
          <div className={styles.headerActions}>
            {data && (
              <>
                <input
                  className={styles.search}
                  placeholder="Cari kode / deskripsi..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <button className={styles.btnExport} onClick={exportExcel}>
                  ↓ Export Excel
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {!data && (
          <div
            className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current.click()}
          >
            <input ref={fileRef} type="file" accept=".txt" style={{ display: 'none' }} onChange={e => processFile(e.target.files[0])} />
            <div className={styles.dropIcon}>⬆</div>
            <div className={styles.dropTitle}>{loading ? 'Memproses...' : 'Upload File TXT'}</div>
            <div className={styles.dropSub}>Drag & drop atau klik untuk memilih file</div>
            <div className={styles.dropHint}>.txt — Kartu Stok format</div>
          </div>
        )}

        {data && (
          <div className={styles.controlBar}>
            <div className={styles.fileTag}>
              <span className={styles.fileTagIcon}>▣</span>
              {fileName}
            </div>
            <label className={styles.toggle}>
              <input type="checkbox" checked={cleanKode} onChange={e => setCleanKode(e.target.checked)} />
              <span className={styles.toggleTrack} />
              <span className={styles.toggleLabel}>Clean Kode Barang</span>
            </label>
            <button className={styles.btnReupload} onClick={() => { setData(null); setFileName(null); setSearch('') }}>
              ↺ Ganti File
            </button>
            <div className={styles.clickHint}>💡 Klik baris untuk lihat detail transaksi</div>
          </div>
        )}

        {stats && (
          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statVal}>{stats.items.toLocaleString('id-ID')}</div>
              <div className={styles.statLabel}>Total Item</div>
            </div>
            <div className={styles.stat}>
              <div className={`${styles.statVal} ${styles.statIn}`}>{stats.totalIn.toLocaleString('id-ID')}</div>
              <div className={styles.statLabel}>Total IN</div>
            </div>
            <div className={styles.stat}>
              <div className={`${styles.statVal} ${styles.statOut}`}>{stats.totalOut.toLocaleString('id-ID')}</div>
              <div className={styles.statLabel}>Total OUT</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statVal}>{stats.withTx.toLocaleString('id-ID')}</div>
              <div className={styles.statLabel}>Punya Transaksi</div>
            </div>
            {search && (
              <div className={styles.stat}>
                <div className={styles.statVal}>{sortedData.length.toLocaleString('id-ID')}</div>
                <div className={styles.statLabel}>Hasil Filter</div>
              </div>
            )}
          </div>
        )}

        {data && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {COLS.map(col => (
                    <th key={col.key} className={`${styles.th} ${styles['align_' + col.align]}`} onClick={() => handleSort(col.key)}>
                      {col.label}
                      {sortKey === col.key && <span className={styles.sortArrow}>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row, i) => (
                  <tr key={i} className={styles.tr} onClick={() => setSelectedItem(row)} title="Klik untuk lihat transaksi">
                    {COLS.map(col => (
                      <td key={col.key} className={[
                        styles.td,
                        styles['align_' + col.align],
                        col.color === 'in' ? styles.tdIn : '',
                        col.color === 'out' ? styles.tdOut : '',
                        col.color === 'saldo' ? styles.tdSaldo : '',
                        col.key === 'hasTx' ? (row[col.key] ? styles.tdYes : styles.tdNo) : '',
                        col.key === 'kodeBarang' ? styles.tdKode : '',
                      ].join(' ')}>
                        {fmt(row[col.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {sortedData.length === 0 && (
              <div className={styles.empty}>Tidak ada hasil untuk "{search}"</div>
            )}
          </div>
        )}
      </main>

      <footer className={styles.footer}>
        Kartu Stok Rule 2 Processor — running saldo method
      </footer>

      {selectedItem && (
        <TransactionModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </div>
  )
}
