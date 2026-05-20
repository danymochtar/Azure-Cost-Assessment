import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Azure Cost Assessment",
  description: "Upload anything. Get a live-priced Azure BOM.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
