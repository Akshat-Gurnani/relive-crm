import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Relive CRM",
  description: "Lead management for Relive Solutions",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Relive CRM", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#0b0e14", colorScheme: "dark", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
