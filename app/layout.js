import "./globals.css";
import { SessionProvider } from "next-auth/react"
import { headers } from 'next/headers'
import { LanguageProvider } from '@/app/contexts/LanguageContext'
import { ThemeProvider } from '@/app/contexts/ThemeContext'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lingdaily.yasobi.xyz';

export const metadata = {
  title: "LingDaily - Chat with AI to Learn English | AI English Tutor",
  description: "Master English through AI-powered conversations about current news. Practice speaking, improve vocabulary, and gain confidence with our intelligent English learning platform. Chat with AI to learn English naturally and effectively.",
  keywords: ["chat with ai to learn english", "ai english tutor", "english learning", "ai conversation", "speak english practice", "english vocabulary", "news english", "ai language learning", "english conversation practice", "learn english online"],
  authors: [{ name: "LingDaily" }],
  creator: "LingDaily",
  publisher: "LingDaily",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: "LingDaily - Chat with AI to Learn English",
    description: "Master English through AI-powered conversations about current news. Practice speaking, improve vocabulary, and gain confidence naturally.",
    url: siteUrl,
    siteName: 'LingDaily',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'LingDaily - Chat with AI to Learn English',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "LingDaily - Chat with AI to Learn English",
    description: "Master English through AI-powered conversations about current news. Practice speaking and improve vocabulary naturally.",
    images: ['/og-image.jpg'],
    creator: '@LingDaily',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-site-verification',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default async function RootLayout({ children }) {
  const h = await headers()
  const acceptLanguage = h.get('accept-language') || ''
  const themeScript = `(()=>{try{var s=localStorage.getItem('theme');var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var t=s==='light'?'light':s==='dark'?'dark':(m?'dark':'light');var d=document.documentElement;d.classList.toggle('dark',t==='dark');}catch(e){document.documentElement.classList.add('dark');}})()`
  return (
    <html lang="en" suppressHydrationWarning className="bg-background">
      <body suppressHydrationWarning className="bg-background min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <SessionProvider>
          <LanguageProvider initialAcceptLanguage={acceptLanguage}>
            <ThemeProvider>
              {children}
            </ThemeProvider>
          </LanguageProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
