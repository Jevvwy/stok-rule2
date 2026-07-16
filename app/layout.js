import './globals.css'
export const metadata = { title: 'Kartu Stok — Rule 2', description: 'Proses Kartu Stok Rule 2' }
export default function RootLayout({ children }) {
  return (
    <html lang="id"><head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
    </head><body>{children}</body></html>
  )
}
