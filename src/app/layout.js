import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "Catalyst Operations Console — Bulk Email & User Provisioning",
  description:
    "Enterprise Zoho Catalyst automation console for bulk transactional email dispatch, user provisioning, and directory management.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="font-sans min-h-screen bg-[#09090B] text-zinc-100">
        {children}
      </body>
    </html>
  );
}
