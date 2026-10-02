import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Editorial display face for headlines on the marketing/entry screens.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Clockwise — One trip. Many clocks.",
  description:
    "The coordination, execution and recovery layer for group travel.",
  appleWebApp: { capable: true, title: "Clockwise", statusBarStyle: "default" },
  icons: { apple: "/icons/192" },
};

export const viewport: Viewport = {
  themeColor: "#163a2c",
  // Lets the app draw under the notch/home indicator; TopBar/BottomNav add
  // the matching safe-area padding.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="h-full flex flex-col">{children}</body>
    </html>
  );
}
