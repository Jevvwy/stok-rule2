// parser.js — full extraction with fixed column parsing for all transaction types

const TOKEN_NUM_RE = /^[\d\-\(\),\.]+$/

function normalizeNum(s) {
  if (s == null) return null
  s = String(s).trim()
  if (s === '' || s.toUpperCase() === 'N/A') return null
  let neg = false
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/\s/g, '').replace(/,/g, '').replace(/[^0-9.\-]/g, '')
  if (s === '' || s === '-') return null

  // Handle dot as THOUSAND separator (Indonesian format): 1.000, 12.345, 1.234.567
  // Pattern: groups of exactly 3 digits after each dot = thousand separator, strip dots
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '')
  }

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
  if (!adm) return { admUser: '', admTanggal: '', admDay: null, admMonth: null }
  adm = adm.trim()
  // Format 1: LETTERS-DDMM  e.g. DAB-2904
  let m = adm.match(/^([A-Za-z]+)-(\d{2})(\d{2})$/)
  if (m) {
    return { admUser: m[1], admTanggal: `${m[2]}/${m[3]}`, admDay: parseInt(m[2]), admMonth: parseInt(m[3]) }
  }
  // Format 2: NUM--DDMM  e.g. 03--0804
  m = adm.match(/^(\w+)--(\d{2})(\d{2})$/)
  if (m) {
    return { admUser: m[1], admTanggal: `${m[2]}/${m[3]}`, admDay: parseInt(m[2]), admMonth: parseInt(m[3]) }
  }
  // Format 3: NUM-DDMM  e.g. 015-1704
  m = adm.match(/^(\d+)-(\d{2})(\d{2})$/)
  if (m) {
    return { admUser: m[1], admTanggal: `${m[2]}/${m[3]}`, admDay: parseInt(m[2]), admMonth: parseInt(m[3]) }
  }
  return { admUser: adm, admTanggal: '', admDay: null, admMonth: null }
}

function calcSelisih(tglPO, admDay, admMonth) {
  if (!tglPO || admDay == null || admMonth == null) return { days: null, hasWeekend: false }
  const parts = tglPO.split('/')
  if (parts.length < 3) return { days: null, hasWeekend: false }
  const poDay = parseInt(parts[0]), poMonth = parseInt(parts[1]), poYear = parseInt(parts[2])
  let admYear = poYear
  if (admMonth < poMonth) admYear = poYear + 1
  const poDate = new Date(poYear, poMonth - 1, poDay)
  const admDate = new Date(admYear, admMonth - 1, admDay)
  const diffDays = Math.round((admDate - poDate) / (1000 * 60 * 60 * 24))
  let hasWeekend = (poDate.getDay() === 0 || poDate.getDay() === 6)
  if (!hasWeekend) {
    let d = new Date(poDate)
    d.setDate(d.getDate() + 1)
    while (d < admDate) {
      if (d.getDay() === 0 || d.getDay() === 6) { hasWeekend = true; break }
      d.setDate(d.getDate() + 1)
    }
  }
  return { days: diffDays, hasWeekend }
}

// Parse a transaction line — handles variable column counts per jenis
function parseTxLine(raw) {
  // Extract date + time
  const dateTimeMatch = raw.match(/^(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/)
  if (!dateTimeMatch) return null
  const tglPO = dateTimeMatch[1]
  const waktu = dateTimeMatch[2] || ''

  // Extract ADM from end: patterns like 006-0904, THE-0602, 014-1905
  const admMatch = raw.match(/\s+([\w]+-{1,2}\d{4})\s*$/)
  const admRaw = admMatch ? admMatch[1] : ''
  const { admUser, admTanggal, admDay, admMonth } = parseAdm(admRaw)

  // Remove date+time and ADM from raw to get middle
  const withoutAdm = admMatch ? raw.slice(0, raw.lastIndexOf(admMatch[0])).trim() : raw
  const middle = withoutAdm.slice(dateTimeMatch[0].length).trim()

  // Split by 2+ spaces to get fields
  const fields = middle.split(/\s{2,}/).map(s => s.trim()).filter(Boolean)

  // Fields order (from header): NO_TX, JENIS, CUST/SUPP, NO_REFF, TYPE, IN, OUT, SALDO
  // But some transactions skip CUST/SUPP and NO_REFF
  // Detect by finding which field is the TYPE keyword
  const TYPE_KEYWORDS = ['BPB', 'BPB/R.j', 'DO', 'ADJ(-)', 'ADJ(+)', 'S.O Rutin', 'PO']

  let noTx = '', jenisTrs = '', kodeCust = '', noReff = '', type = ''
  let inQty = null, outQty = null, saldo = null

  // Find numeric tail from the end
  const allToks = middle.split(/\s+/)
  const numTail = []
  for (let i = allToks.length - 1; i >= 0; i--) {
    if (isValidToken(allToks[i])) numTail.unshift(allToks[i])
    else break
  }

  // SALDO is always last number
  if (numTail.length >= 1) saldo = normalizeNum(numTail[numTail.length - 1])

  // Find TYPE field — it's the last non-numeric text field before the numbers
  // Strategy: find the TYPE keyword in fields
  let typeIdx = -1
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i].toUpperCase()
    if (f === 'BPB/R.J' || f === 'BPB' || f === 'DO' || f === 'PO' ||
        f === 'ADJ(-)' || f === 'ADJ(+)' || f.includes('S.O') || f.includes('ADJ')) {
      typeIdx = i
    }
  }

  if (typeIdx >= 0) {
    type = fields[typeIdx]
    noTx = fields[0] || ''
    jenisTrs = fields[1] || ''
    // Between jenis and type: cust and reff
    if (typeIdx === 4) { kodeCust = fields[2] || ''; noReff = fields[3] || '' }
    else if (typeIdx === 3) { kodeCust = fields[2] || ''; noReff = '' }
    else if (typeIdx === 2) { kodeCust = ''; noReff = '' }
  } else {
    // Fallback
    noTx = fields[0] || ''
    jenisTrs = fields[1] || ''
    kodeCust = fields[2] || ''
    noReff = fields[3] || ''
    type = fields[4] || ''
  }

  return { tglPO, waktu, noTx, jenisTrs, kodeCust, noReff, type, admUser, admTanggal, admDay, admMonth, saldo }
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
      const parsed = parseTxLine(ln.trim())
      if (!parsed) continue

      const { tglPO, waktu, noTx, jenisTrs, kodeCust, noReff, type,
              admUser, admTanggal, admDay, admMonth, saldo: SAL } = parsed

      let qtyIn = 0, qtyOut = 0
      if (typeof lastRunningSaldo === 'number' && typeof SAL === 'number') {
        const delta = SAL - lastRunningSaldo
        if (delta > 0) { qtyIn = delta; qtyOut = 0 }
        else if (delta < 0) { qtyIn = 0; qtyOut = Math.abs(delta) }
      }

      const { days: selisihHari, hasWeekend: admHasWeekend } = calcSelisih(tglPO, admDay, admMonth)
      const isBeliNkl = jenisTrs.toLowerCase().includes('beli nkl')
      const isLambat = isBeliNkl && selisihHari !== null && selisihHari >= 2
      const isBpbRj = type === 'BPB/R.j' || type === 'BPB/R.J'
      // BPB/R.j dengan IN & OUT kosong = transaksi batal (barang tidak ada / customer ganti barang)
      const isBpbRjBatal = isBpbRj && qtyIn === 0 && qtyOut === 0

      transactions.push({
        tglPO, waktu, noTx, jenisTrs, kodeCust, noReff, type,
        in: qtyIn, out: qtyOut, saldo: SAL,
        admUser, admTanggal, admRaw: admUser ? `${admUser}-${admTanggal}` : '',
        selisihHari, admHasWeekend, isBeliNkl, isLambat, isBpbRj, isBpbRjBatal,
      })

      if (typeof SAL === 'number') lastRunningSaldo = SAL
    }
  }

  if (current) finalizeCurrent()
  return items
}

// Returns flat list of all Beli nkl with selisih >= 2
export function getBeliNklLambat(items) {
  const rows = []
  for (const item of items) {
    for (const t of item.transactions) {
      if (t.isLambat) {
        rows.push({
          kodeBarang: item.kodeBarang, deskripsi: item.deskripsi, unit: item.unit,
          tglPO: t.tglPO, waktu: t.waktu, noTx: t.noTx, jenisTrs: t.jenisTrs,
          kodeCust: t.kodeCust, noReff: t.noReff, type: t.type,
          qty: t.in, saldo: t.saldo,
          admUser: t.admUser, admTanggal: t.admTanggal,
          selisihHari: t.selisihHari, hasWeekend: t.admHasWeekend,
        })
      }
    }
  }
  return rows
}

// Returns flat list of all Adj Min nkl (ADJ-) transactions
export function getAdjMin(items) {
  const rows = []
  for (const item of items) {
    for (const t of item.transactions) {
      const isAdjMin = t.jenisTrs.toLowerCase().includes('adj min nkl') || 
                       t.jenisTrs.toLowerCase().includes('adj min')
      if (isAdjMin) {
        rows.push({
          kodeBarang: item.kodeBarang, deskripsi: item.deskripsi, unit: item.unit,
          tglPO: t.tglPO, waktu: t.waktu, noTx: t.noTx, jenisTrs: t.jenisTrs,
          noReff: t.noReff, type: t.type,
          qtyIn: t.in, qtyOut: t.out, saldo: t.saldo,
          admUser: t.admUser, admTanggal: t.admTanggal,
        })
      }
    }
  }
  return rows
}

// Returns analysis: per kode barang, match BPB/R.j vs ADJ(-) 
export function getAdjAnalysis(items) {
  const map = {}
  for (const item of items) {
    const key = item.kodeBarang
    if (!map[key]) map[key] = { kodeBarang: key, deskripsi: item.deskripsi, unit: item.unit, bpbRjList: [], adjMinList: [], soList: [] }
    for (const t of item.transactions) {
      const isBpbRj = t.type === 'BPB/R.j' || t.type === 'BPB/R.J'
      const jenisLower = t.jenisTrs.toLowerCase()
      const typeUpper = (t.type || '').toUpperCase()
      const isSORutin = typeUpper.includes('S.O')
      // ADJ(-) murni = Adj Min nkl dengan type ADJ(-), BUKAN yang dari S.O Rutin
      const isAdjMin = (jenisLower.includes('adj min')) && !isSORutin
      if (isBpbRj) map[key].bpbRjList.push({ tglPO: t.tglPO, noTx: t.noTx, kodeCust: t.kodeCust, noReff: t.noReff, qtyOut: t.out, qtyIn: t.in, admUser: t.admUser, admTanggal: t.admTanggal, batal: t.isBpbRjBatal })
      if (isAdjMin) map[key].adjMinList.push({ tglPO: t.tglPO, noTx: t.noTx, noReff: t.noReff, qtyOut: t.out, qtyIn: t.in, admUser: t.admUser, admTanggal: t.admTanggal })
      // S.O Rutin: baik Adj Min maupun Adj Plus
      if (isSORutin) map[key].soList.push({ tglPO: t.tglPO, noTx: t.noTx, noReff: t.noReff, jenisTrs: t.jenisTrs, qtyOut: t.out, qtyIn: t.in, saldo: t.saldo, admUser: t.admUser, admTanggal: t.admTanggal })
    }
  }
  // Only return items that have at least one BPB/R.j or ADJ(-)
  return Object.values(map)
    .filter(r => r.bpbRjList.length > 0 || r.adjMinList.length > 0)
    .map(r => {
      // Batal (IN & OUT kosong) tidak dihitung untuk status — tidak butuh ADJ(-)
      const activeBpb = r.bpbRjList.filter(t => !t.batal).length
      const batalBpb = r.bpbRjList.filter(t => t.batal).length
      let status
      if (activeBpb > 0 && r.adjMinList.length === 0) status = 'NO_ADJ'
      else if (activeBpb > 0 && r.adjMinList.length > 0) status = 'BOTH'
      else if (r.adjMinList.length > 0) status = 'ADJ_ONLY'
      else status = 'BATAL_ONLY' // hanya BPB/R.j batal, tidak ada ADJ — wajar
      return { ...r, activeBpb, batalBpb, status }
    })
    .sort((a, b) => {
      const order = { NO_ADJ: 0, BOTH: 1, ADJ_ONLY: 2, BATAL_ONLY: 3 }
      return order[a.status] - order[b.status]
    })
}

// Returns flat list of all BPB/R.j transactions
export function getBpbRj(items) {
  const rows = []
  for (const item of items) {
    for (const t of item.transactions) {
      if (t.isBpbRj) {
        rows.push({
          kodeBarang: item.kodeBarang, deskripsi: item.deskripsi, unit: item.unit,
          tglPO: t.tglPO, waktu: t.waktu, noTx: t.noTx, jenisTrs: t.jenisTrs,
          kodeCust: t.kodeCust, noReff: t.noReff, type: t.type,
          qtyIn: t.in, qtyOut: t.out, saldo: t.saldo,
          admUser: t.admUser, admTanggal: t.admTanggal,
          batal: t.isBpbRjBatal,
        })
      }
    }
  }
  return rows
}
