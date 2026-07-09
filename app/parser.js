// parser.js — JS port of stok_rule2 Python parser (with transaction details)

const TOKEN_NUM_RE = /^[\d\-\(\),\.]+$/

function normalizeNum(s) {
  if (s == null) return null
  s = String(s).trim()
  if (s === '' || s.toUpperCase() === 'N/A') return null
  let neg = false
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true
    s = s.slice(1, -1)
  }
  s = s.replace(/\s/g, '').replace(/,/g, '')
  s = s.replace(/[^0-9.\-]/g, '')
  if (s === '' || s === '-') return null
  let v
  try {
    v = s.includes('.') ? parseFloat(s) : parseInt(s, 10)
    if (isNaN(v)) {
      const m = s.match(/-?\d+/)
      v = m ? parseInt(m[0], 10) : null
    }
  } catch {
    v = null
  }
  return neg ? -v : v
}

function isValidToken(tok) {
  if (!TOKEN_NUM_RE.test(tok)) return false
  if (/-/.test(tok.slice(1))) return false
  if ((tok.match(/\./g) || []).length > 1) return false
  return tok.replace(/[.,]/g, '').length <= 9
}

export function processTextToDf(text, cleanKode = true) {
  const lines = text.split(/\r?\n/)
  const items = []
  let current = null
  let transactions = []
  let lastRunningSaldo = null

  function finalizeCurrent() {
    if (!current) return

    let totalIn = 0
    let totalOut = 0
    let lastSaldo = null
    let hasTx = false

    for (const t of transactions) {
      hasTx = true
      if (typeof t.in === 'number') totalIn += t.in
      if (typeof t.out === 'number') totalOut += t.out
      if (typeof t.saldo === 'number') lastSaldo = t.saldo
    }

    const saldoAwal = current.saldoAwal

    let saldoAkhir
    if (hasTx && lastSaldo !== null) {
      saldoAkhir = lastSaldo
    } else if (!hasTx) {
      saldoAkhir = saldoAwal
    } else {
      const base = saldoAwal !== null ? saldoAwal : 0
      saldoAkhir = base + totalIn - totalOut
    }

    let kode = current.kode
    if (cleanKode) {
      kode = kode.replace(/-/g, '').replace(/^0+/, '')
    }

    items.push({
      kodeBarang: kode,
      deskripsi: current.desc,
      unit: current.unit,
      saldoAwal: saldoAwal,
      totalIn: Math.round(totalIn),
      totalOut: Math.round(totalOut),
      saldoAkhir: Math.round(saldoAkhir !== null ? saldoAkhir : 0),
      hasTx,
      transactions: transactions.map(t => ({ ...t })),
    })
  }

  for (const ln of lines) {
    if (ln.startsWith('KODE BARANG :')) {
      if (current) finalizeCurrent()

      let code, desc, unit
      const m = ln.match(/KODE BARANG :\s*([-\d\w]+)\s*(.*?)\s+Unit:\s*(\S+)/)
      if (m) {
        ;[, code, desc, unit] = m
      } else {
        const parts = ln.replace('KODE BARANG :', '').split('Unit:')
        const left = parts[0].trim().split(/\s+/)
        code = left[0]
        desc = left.slice(1).join(' ')
        unit = parts[1] ? parts[1].trim() : ''
      }

      current = { kode: code, desc: desc.trim(), unit: unit.trim(), saldoAwal: null }
      transactions = []
      lastRunningSaldo = null
      continue
    }

    if (!current) continue

    if (ln.trim().startsWith('SALDO AWAL')) {
      const toks = ln.trim().split(/\s+/)
      for (let i = toks.length - 1; i >= 0; i--) {
        if (isValidToken(toks[i])) {
          current.saldoAwal = normalizeNum(toks[i])
          break
        }
      }
      lastRunningSaldo = current.saldoAwal
      continue
    }

    if (/^\d{2}\/\d{2}\/\d{4}/.test(ln.trim())) {
      // Extract date
      const dateMatch = ln.trim().match(/^(\d{2}\/\d{2}\/\d{4})/)
      const date = dateMatch ? dateMatch[1] : ''

      // Extract description (text between date and numbers at end)
      const core = ln.trim().replace(/\s+\d{3}-\d{4}$/, '')
      const tail = core.slice(-100)
      const toks = tail.trim().split(/\s+/)
      const nums = toks.filter(isValidToken)

      // Get description text (non-numeric middle part)
      const afterDate = core.slice(date.length).trim()
      const descParts = afterDate.split(/\s+/)
      const descWords = []
      for (const w of descParts) {
        if (isValidToken(w)) break
        descWords.push(w)
      }
      const txDesc = descWords.join(' ').trim()

      let SAL = null
      if (nums.length >= 1) SAL = normalizeNum(nums[nums.length - 1])

      let IN = 0, OUT = 0
      if (typeof lastRunningSaldo === 'number' && typeof SAL === 'number') {
        const delta = SAL - lastRunningSaldo
        if (delta > 0) { IN = delta; OUT = 0 }
        else if (delta < 0) { IN = 0; OUT = Math.abs(delta) }
        else { IN = 0; OUT = 0 }
      }

      transactions.push({ date, desc: txDesc, in: IN, out: OUT, saldo: SAL })
      if (typeof SAL === 'number') lastRunningSaldo = SAL
    }
  }

  if (current) finalizeCurrent()
  return items
}
