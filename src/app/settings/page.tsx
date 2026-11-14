import type { Metadata } from "next";
import SettingsApp from "@/components/settings/SettingsApp";

export const metadata: Metadata = {
  title: "교회 설정 · 예봄일정",
  description: "예봄일정의 교회력 참고 표시, 실제 장소와 검증된 사용자의 일정 담당 권한을 관리합니다.",
};

export default function SettingsPage() {
  return <SettingsApp />;
}
