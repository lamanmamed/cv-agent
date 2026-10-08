import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CV Agent",
  description: "Tailor your CV to a role with source-linked suggestions and control over every change.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
