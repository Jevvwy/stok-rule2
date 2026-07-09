// parser.js — full extraction + H+1 detection for Beli nkl

const TOKEN_NUM_RE = /^[\d\-\(\),\.]+$/

function normalizeNum(s) {
  if (s == null) return null
  s = String(s).trim()
  if (s === '' || s.toUpperCase() === 'N/A') return null
  let neg = false
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/\s/g, '').replace(/,/g, '').replace(/[^0-9.\-]/g, '')
  if (s === '' || s === '-') return null
  let v
  try {
    v = s.includes('.') ? parseFloat(s) : parseInt(s, 10)
    if (isNaN(v)) { const m = s.match(/-?\d+/); v = m ? parseInt(m[0], 10) : null }
  } catch { v = null }
  return neg ? -v : v
}

function isValidToken(tok) {
  if (!TOKEN_NUM_RE.test(tok)) return false
  if (/-/.test(tok.slice(1))) return false
  if ((tok.match(/\./g) || []).length > 1) return false
  return tok.replace(/[.,]/g, '').length <= 9
}

function parseAdm(adm) {
  if (!adm) return { admUser: '', admTanggal: '', admDate: null }
  adm = adm.trim()
  let m = adm.match(/^([A-Za-z]+)-(\d{2})(\d{2})$/)
  if (m) {
    const dd = parseInt(m[2]), mm = parseInt(m[3])
    return { admUser: m[1], admTanggal: `${m[2]}/${m[3]}`, admDay: dd, admMonth: mm }
  }
  m = adm.match(/^(\w+)--(\d{2})(\d{2})$/)
  if (m) {
    const dd = parseInt(m[2]), mm = parseInt(m[3])
    return { admUser: m[1], admTanggal: `${m[2]}/${m[3]}`, admDay: dd, admMonth: mm }
  }
  return { admUser: adm, admTanggal: '', admDay: null, admMonth: null }
}

// Calculate day difference between tglPO and ADM input date
// Returns integer: 0 = same day, 1 = H+1, 2 = H+2, etc.
function calcSelisih(tglPO, admDay, admMonth) {
  if (!tglPO || admDay == null || admMonth == null) return null
  const parts = tglPO.split('/')
  if (parts.length < 3) return null
  const poDay = parseInt(parts[0])
  const poMonth = parseInt(parts[1])
  const poYear = parseInt(parts[2])
  // Use same year as PO for ADM date (ADM only stores DD/MM)
  // Handle month rollover: if ADM month < PO month, ADM is next year
  let admYear = poYear
  if (admMonth < poMonth) admYear = poYear + 1
  const poDate = new Date(poYear, poMonth - 1, poDay)
  const admDate = new Date(admYear, admMonth - 1, admDay)
  const diffMs = admDate - poDate
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  return diffDays
}

export function processTextToDf(text, cleanKode = true) {
  const lines = text.split(/\r?\n/)
  const items = []
  let current = null
  let transactions = []
  let lastRunningSaldo = null

  function finalizeCurrent() {
    if (!current) return
    let totalIn = 0, totalOut = 0, lastSaldo = null, hasTx = false
    for (const t of transactions) {
      hasTx = true
      if (typeof t.in === 'number') totalIn += t.in
      if (typeof t.out === 'number') totalOut += t.out
      if (typeof t.saldo === 'number') lastSaldo = t.saldo
    }
    const saldoAwal = current.saldoAwal
    let saldoAkhir
    if (hasTx && lastSaldo !== null) saldoAkhir = lastSaldo
    else if (!hasTx) saldoAkhir = saldoAwal
    else { const base = saldoAwal !== null ? saldoAwal : 0; saldoAkhir = base + totalIn - totalOut }

    let kode = current.kode
    if (cleanKode) kode = kode.replace(/-/g, '').replace(/^0+/, '')

    items.push({
      kodeBarang: kode, deskripsi: current.desc, unit: current.unit,
      saldoAwal, totalIn: Math.round(totalIn), totalOut: Math.round(totalOut),
      saldoAkhir: Math.round(saldoAkhir !== null ? saldoAkhir : 0),
      hasTx, transactions: transactions.map(t => ({ ...t })),
    })
  }

  for (const ln of lines) {
    if (ln.startsWith('---') || ln.startsWith('BU:') || ln.startsWith('STOCK:') ||
        ln.startsWith('KE HAL') || ln.trim().startsWith('TGL') ||
        ln.trim().startsWith('TRANSAKSI') || ln.trim() === '') continue

    if (ln.startsWith('KODE BARANG :')) {
      if (current) finalizeCurrent()
      let code, desc, unit
      const m = ln.match(/KODE BARANG :\s*([-\d\w]+)\s*(.*?)\s+Unit:\s*(\S+)/)
      if (m) { [, code, desc, unit] = m }
      else {
        const parts = ln.replace('KODE BARANG :', '').split('Unit:')
        const left = parts[0].trim().split(/\s+/)
        code = left[0]; desc = left.slice(1).join(' ')
        unit = parts[1] ? parts[1].trim() : ''
      }
      current = { kode: code, desc: desc.trim(), unit: unit.trim(), saldoAwal: null }
      transactions = []; lastRunningSaldo = null
      continue
    }

    if (!current) continue

    if (ln.trim().startsWith('SALDO AWAL')) {
      const toks = ln.trim().split(/\s+/)
      for (let i = toks.length - 1; i >= 0; i--) {
        if (isValidToken(toks[i])) { current.saldoAwal = normalizeNum(toks[i]); break }
      }
      lastRunningSaldo = current.saldoAwal
      continue
    }

    if (/^\d{2}\/\d{2}\/\d{4}/.test(ln.trim())) {
      const raw = ln.trim()

      const dateTimeMatch = raw.match(/^(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/)
      const tglPO = dateTimeMatch ? dateTimeMatch[1] : ''
      const waktu = dateTimeMatch ? (dateTimeMatch[2] || '') : ''

      const admMatch = raw.match(/\s+([\w]+-{1,2}\d{4})\s*$/)
      const admRaw = admMatch ? admMatch[1] : ''
      const { admUser, admTanggal, admDay, admMonth } = parseAdm(admRaw)

      const withoutAdm = admMatch ? raw.slice(0, raw.lastIndexOf(admMatch[0])).trim() : raw

      const allToks = withoutAdm.trim().split(/\s+/)
      const numToks = []
      for (let i = allToks.length - 1; i >= 0; i--) {
        if (isValidToken(allToks[i])) numToks.unshift(allToks[i])
        else break
      }

      let SAL = null, qtyIn = 0, qtyOut = 0
      if (numToks.length >= 1) SAL = normalizeNum(numToks[numToks.length - 1])

      if (typeof lastRunningSaldo === 'number' && typeof SAL === 'number') {
        const delta = SAL - lastRunningSaldo
        if (delta > 0) { qtyIn = delta; qtyOut = 0 }
        else if (delta < 0) { qtyIn = 0; qtyOut = Math.abs(delta) }
        else { qtyIn = 0; qtyOut = 0 }
      }

      const afterDateTime = raw.slice(dateTimeMatch ? dateTimeMatch[0].length : 0).trimStart()
      const beforeNums = numToks.length > 0
        ? afterDateTime.slice(0, afterDateTime.lastIndexOf(numToks[0])).trimEnd()
        : afterDateTime

      const textFields = beforeNums.split(/\s{2,}/).map(s => s.trim()).filter(Boolean)
      const noTx     = textFields[0] || ''
      const jenisTrs = textFields[1] || ''
      const kodeCust = textFields[2] || ''
      const noReff   = textFields[3] || ''
      const type     = textFields[4] || ''

      const selisihHari = calcSelisih(tglPO, admDay, admMonth)
      const isBeliNkl = jenisTrs.toLowerCase().includes('beli nkl')
      const isLambat = isBeliNkl && selisihHari !== null && selisihHari >= 1

      transactions.push({
        tglPO, waktu, noTx, jenisTrs, kodeCust, noReff, type,
        in: qtyIn, out: qtyOut, saldo: SAL,
        admUser, admTanggal, admRaw,
        selisihHari,
        isBeliNkl,
        isLambat,
      })

      if (typeof SAL === 'number') lastRunningSaldo = SAL
    }
  }

  if (current) finalizeCurrent()
  return items
}

// Returns flat list of all "Beli nkl" rows with selisih >= 1
export function getBeliNklLambat(items) {
  const rows = []
  for (const item of items) {
    for (const t of item.transactions) {
      if (t.isLambat) {
        rows.push({
          kodeBarang: item.kodeBarang,
          deskripsi: item.deskripsi,
          unit: item.unit,
          tglPO: t.tglPO,
          waktu: t.waktu,
          noTx: t.noTx,
          jenisTrs: t.jenisTrs,
          kodeCust: t.kodeCust,
          noReff: t.noReff,
          type: t.type,
          qty: t.in,
          saldo: t.saldo,
          admUser: t.admUser,
          admTanggal: t.admTanggal,
          selisihHari: t.selisihHari,
        })
      }
    }
  }
  return rows
}
