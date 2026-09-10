import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agenda RN",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
