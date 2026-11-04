import type { Metadata } from "next";
import { Heebo, IBM_Plex_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/layout/providers";
import { getDictionary, isLocale, LOCALES } from "@/lib/i18n";
import "../globals.css";

const heebo = Heebo({ subsets: ["hebrew", "latin"], variable: "--font-heebo", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "he");
  return { title: { default: dict.app.name, template: `%s · ${dict.app.short}` }, description: dict.app.tagline };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  return (
    <html lang={dict.meta.lang} dir={dict.meta.dir} className={`${heebo.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <Providers locale={locale} dict={dict}>
          <AppShell footer={dict.common.notRecommendation}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
