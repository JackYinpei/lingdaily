import Link from "next/link";
import { auth, signOut } from "@/app/auth";
import { AuthError } from "next-auth";
import HomePageClient from "@/app/components/HomePageClient";
import { headers } from "next/headers";

export const revalidate = 3600;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lingdaily.yasobi.xyz';

function detectPreferredLocale(acceptLanguageHeader = "") {
  const parts = acceptLanguageHeader
    .split(",")
    .map((part) => part.trim().split(";")[0].toLowerCase())
    .filter(Boolean);

  for (const code of parts) {
    if (code.startsWith("zh")) return "zh";
    if (code.startsWith("ja")) return "ja";
  }

  return "en";
}

export const metadata = {
  title: 'LingDaily - AI English Learning with Daily News Podcasts',
  description: 'Master English with LingDaily. Chat with AI about current news, listen to daily AI-generated podcasts, and build your vocabulary. Real-time conversations and immersive audio learning.',
  keywords: 'English learning, AI tutor, daily news podcasts, English conversation, vocabulary building, speaking practice, LingDaily',
  openGraph: {
    title: 'LingDaily - Learn English with AI & News Podcasts',
    description: 'Join LingDaily to practice English through real-time AI conversations and daily news podcasts customized for learners.',
  }
};

export default async function Home() {
  let session = null;
  try {
    session = await auth();
  } catch (error) {
    if (error instanceof AuthError && error.type === "JWTSessionError") {
      console.warn("auth() failed to decode session token, ignoring cookie", error);
      session = null;
    } else {
      throw error;
    }
  }

  async function signOutAction() {
    'use server'
    await signOut()
  }

  const headersList = await headers();
  const acceptLanguageHeader = headersList.get("accept-language") || "";
  const locale = detectPreferredLocale(acceptLanguageHeader);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "LingDaily",
    "description": "Chat with AI to learn English through current news conversations and daily AI-generated podcasts. AI-powered English learning platform for vocabulary building, listening, and speaking practice.",
    "url": siteUrl,
    "applicationCategory": "EducationalApplication",
    "operatingSystem": "Web",
    "isAccessibleForFree": true,
    "inLanguage": locale,
    "audience": {
      "@type": "EducationalAudience",
      "educationalRole": "Learner"
    },
    "publisher": {
      "@type": "Organization",
      "name": "LingDaily"
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": siteUrl
    },
    "potentialAction": {
      "@type": "CommunicateAction",
      "target": `${siteUrl}/talk`,
      "name": "Start an English practice conversation"
    }
  };

  return (
    <>
      <noscript>
        <section className="mx-auto my-6 max-w-3xl rounded-2xl border border-border bg-card/60 p-4 text-sm leading-relaxed text-foreground">
          <strong>LingDaily works without JavaScript.</strong> Read curated news summaries and start a guided English conversation at{" "}
          <Link href="/talk">lingdaily.yasobi.xyz/talk</Link>.
        </section>
      </noscript>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <HomePageClient signedIn={!!session?.user} signOutAction={signOutAction} locale={locale} />
    </>
  );
}
