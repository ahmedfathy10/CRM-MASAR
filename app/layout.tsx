import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "مسار CRM — إدارة الفريق والصلاحيات",
  description: "نظام عربي مرن لإدارة الموظفين والصلاحيات ونماذج البيانات الديناميكية.",
  metadataBase: new URL("https://masar-crm-eg.sites.openai.com"),
  openGraph: {
    title: "مسار CRM",
    description: "إدارة مرنة تبدأ من فريقك",
    images: ["/og.png"],
    locale: "ar_EG",
  },
  twitter: {
    card: "summary_large_image",
    title: "مسار CRM",
    description: "إدارة مرنة تبدأ من فريقك",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
