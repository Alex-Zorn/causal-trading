import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Causal Markets — Event impact, mapped",
  description:
    "Explore how global events may ripple through financial markets with transparent, probabilistic causal chains.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
