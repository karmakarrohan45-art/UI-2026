import './globals.css'

export const metadata = {
  title: 'Gene Academy · Auto Edit Studio',
  description: 'Upload a video and let Gene Academy auto edit it for you.'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
