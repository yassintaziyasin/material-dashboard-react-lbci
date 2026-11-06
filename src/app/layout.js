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

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("zc_ops_theme_v1");if(t==="light"){document.documentElement.classList.remove("dark");}else{document.documentElement.classList.add("dark");}}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} dark`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans min-h-screen bg-[#F4F5F7] text-zinc-900 dark:bg-[#09090B] dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
