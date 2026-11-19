import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Go AI Field | HR & IT Helpdesk",
  description:
    "A secure HR & IT helpdesk agent — cited policy answers, your own leave balance through a permission-checked MCP tool, and guardrails. Prototype using fictional sample policies.",
};

export const viewport: Viewport = { themeColor: "#0a0a0b", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${schibsted.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-ink text-paper">{children}</body>
    </html>
  );
}
