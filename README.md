# Kartu Stok Rule 2 — Web App

Upload file TXT kartu stok, proses otomatis, dan export ke Excel — langsung di browser.

## Fitur
- Upload drag & drop atau klik
- Parsing Rule 2 (running saldo method)
- Clean Kode Barang (strip leading zeros & dashes)
- Search / filter kode & deskripsi
- Sort semua kolom
- Export ke Excel (.xlsx)

---

## Deploy ke Vercel (3 langkah)

### 1. Push ke GitHub
```bash
git init
git add .
git commit -m "init stok app"
git remote add origin https://github.com/USERNAME/stok-rule2.git
git push -u origin main
```

### 2. Import di Vercel
1. Buka https://vercel.com/new
2. Klik **"Import Git Repository"**
3. Pilih repo `stok-rule2`
4. Klik **Deploy** — beres!

### 3. Akses
Vercel akan beri URL seperti `https://stok-rule2.vercel.app`

---

## Run lokal (opsional)
```bash
npm install
npm run dev
# Buka http://localhost:3000
```
