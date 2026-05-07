'use client'

import { useState, useRef, useCallback } from 'react'
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

export default function Home() {
  const [data, setData] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [cleanKode, setCleanKode] = useState(true)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
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
    const file = e.dataTransfer.files[0]
    processFile(file)
  }, [processFile])

  const handleFileChange = (e) => {
    processFile(e.target.files[0])
  }

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
      {/* Header */}
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
        {/* Upload zone */}
        {!data && (
          <div
            className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".txt"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <div className={styles.dropIcon}>⬆</div>
            <div className={styles.dropTitle}>
              {loading ? 'Memproses...' : 'Upload File TXT'}
            </div>
            <div className={styles.dropSub}>
              Drag & drop atau klik untuk memilih file
            </div>
            <div className={styles.dropHint}>.txt — Kartu Stok format</div>
          </div>
        )}

        {/* Controls bar after file loaded */}
        {data && (
          <div className={styles.controlBar}>
            <div className={styles.fileTag}>
              <span className={styles.fileTagIcon}>▣</span>
              {fileName}
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={cleanKode}
                onChange={e => setCleanKode(e.target.checked)}
              />
              <span className={styles.toggleTrack} />
              <span className={styles.toggleLabel}>Clean Kode Barang</span>
            </label>
            <button
              className={styles.btnReupload}
              onClick={() => { setData(null); setFileName(null); setSearch('') }}
            >
              ↺ Ganti File
            </button>
          </div>
        )}

        {/* Stats */}
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

        {/* Table */}
        {data && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {COLS.map(col => (
                    <th
                      key={col.key}
                      className={`${styles.th} ${styles['align_' + col.align]}`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      {sortKey === col.key && (
                        <span className={styles.sortArrow}>
                          {sortDir === 'asc' ? ' ↑' : ' ↓'}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row, i) => (
                  <tr key={i} className={styles.tr}>
                    {COLS.map(col => (
                      <td
                        key={col.key}
                        className={[
                          styles.td,
                          styles['align_' + col.align],
                          col.color === 'in' ? styles.tdIn : '',
                          col.color === 'out' ? styles.tdOut : '',
                          col.color === 'saldo' ? styles.tdSaldo : '',
                          col.key === 'hasTx' ? (row[col.key] ? styles.tdYes : styles.tdNo) : '',
                        ].join(' ')}
                      >
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
    </div>
  )
}
