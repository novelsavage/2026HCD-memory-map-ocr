import type { Metadata, Viewport } from "next";
import { Bitcount, DotGothic16 } from "next/font/google";
import "./globals.css";

const bitcount = Bitcount({
  subsets: ["latin"],
  variable: "--font-bitcount"
});

const dotGothic16 = DotGothic16({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-dot-gothic"
});

export const metadata: Metadata = {
  title: "HCD Capture Hub",
  description: "HCD sticky note capture hub for OCR workflows"
};

export const viewport: Viewport = {
  themeColor: "#101820",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${bitcount.variable} ${dotGothic16.variable}`}>
      <body>{children}</body>
    </html>
  );
}
