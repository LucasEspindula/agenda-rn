import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agenda RN",
  description: "Gestão segura de agendas médicas e atendimentos.",
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
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
