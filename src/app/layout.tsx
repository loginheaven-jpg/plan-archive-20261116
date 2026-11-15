import type { Metadata } from "next";
import "./globals.css";
import SaintCheckin from "@/components/auth/SaintCheckin";
export const metadata: Metadata = {
  title: "예봄일정 | 교회 일정, 한눈에 함께",
  description: "예봄교회와 각 부서의 일정을 한곳에서 확인하고 공유하세요.",
  robots: { index: false, follow: false },
  icons: { icon: "/logo.svg", apple: "/logo.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <SaintCheckin />
        {children}
      </body>
    </html>
  );
}
