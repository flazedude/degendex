"use client";

import { usePathname } from "next/navigation";
import { Footer } from "./Footer";

export function ConditionalFooter() {
  const pathname = usePathname();
  if (pathname === "/trade") return null;
  return <Footer />;
}
