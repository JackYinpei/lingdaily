import Link from "next/link";
import { auth, signOut } from "@/app/auth";
import { AuthError } from "next-auth";
import HomePageClient from "@/app/components/HomePageClient";
import { headers } from "next/headers";
import { getSiteUrl } from "@/app/lib/siteUrl.cjs";

export const revalidate = 3600;

const siteUrl = getSiteUrl();

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
  title: 'LingDaily — Practice Languages Through Real Conversations',
  description: 'Practice everyday conversations, role-play real situations, and discuss the news with AI in 8 learning languages. Listen to Chinese–English news podcasts and keep the vocabulary you discover.',
  keywords: 'language practice, AI conversation, role-play, bilingual news podcasts, vocabulary, speaking practice, LingDaily',
  openGraph: {
    title: 'LingDaily — A Little More Conversation',
    description: 'Real-life speaking practice, Chinese–English news podcasts, and words worth keeping. Make language part of your everyday.',
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
    "description": "Practice languages through AI voice conversations, news discussions, and role-play scenarios. Listen to Chinese–English news podcasts and collect useful vocabulary.",
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
      "name": "Start a language practice conversation"
    }
  };

  return (
    <>
      <noscript>
        <section className="mx-auto my-6 max-w-3xl rounded-2xl border border-border bg-card/60 p-4 text-sm leading-relaxed text-foreground">
          <strong>Enable JavaScript for interactive language practice.</strong> You can also browse our{" "}
          <Link href="/podcasts">bilingual news podcasts</Link>.
        </section>
      </noscript>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <HomePageClient signedIn={!!session?.user} signOutAction={signOutAction} locale={locale} />
    </>
  );
}
