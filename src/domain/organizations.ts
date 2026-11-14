import type { OrganizationId } from "./types";

// Finance BUDGET_MATRIX_ORGANIZATIONS, verified 2026-11-14. Names are aliases; IDs never change.
export const ORGANIZATIONS: { id: OrganizationId; name: string; originalName: string; color: string; light: string }[] = [
  { id: "worship", name: "예배부", originalName: "예배부", color: "#176451", light: "#e9f3eb" },
  { id: "mission", name: "선교부", originalName: "선교부", color: "#276776", light: "#e8f3f6" },
  { id: "house", name: "가정교회부", originalName: "가정교회부", color: "#706638", light: "#f1f0e2" },
  { id: "children", name: "어린이부", originalName: "어린이부", color: "#986511", light: "#fff3d7" },
  { id: "youth", name: "청소년부", originalName: "청소년부", color: "#426297", light: "#edf1fc" },
  { id: "young", name: "청년부", originalName: "청년부", color: "#7751a1", light: "#f0eafa" },
  { id: "care", name: "사랑봉사부", originalName: "사랑봉사부", color: "#9a5148", light: "#f9eeea" },
  { id: "events", name: "행사부", originalName: "행사부", color: "#846199", light: "#f1ebf8" },
  { id: "facility", name: "시설부", originalName: "시설부", color: "#52705e", light: "#edf3ee" },
  { id: "admin", name: "전교회", originalName: "당회", color: "#465d70", light: "#ecf1f5" },
];
export const organization = (id: string) => ORGANIZATIONS.find(o => o.id === id) ?? ORGANIZATIONS[9];
export const ORGANIZATION_SOURCE = "재정부 예산 책임 조직 · 2026-11-14 확인 · 자동 동기화 전";
