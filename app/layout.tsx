import type { Metadata } from "next";
import "./globals.css";
import ClientMonitor from "@/components/client-monitor";

export const metadata: Metadata = {
  title: "RN Integra",
  description: "Gestão segura de agendas médicas e atendimentos.",
  icons: {
    icon: "/agenda-rn-icon.jpg",
    shortcut: "/agenda-rn-icon.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased"><ClientMonitor />{children}</body>
    </html>
  );
}
