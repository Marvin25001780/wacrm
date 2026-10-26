import type { Metadata } from "next";

import { PosShell } from "@/components/pos/pos-shell";

export const metadata: Metadata = {
  title: "Nexus POS",
  robots: { index: false, follow: false },
};

export default function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PosShell>{children}</PosShell>;
}
