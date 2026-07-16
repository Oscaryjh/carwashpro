import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TETAMU POS",
  description: "Multi-tenant car wash CRM POS foundation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
