import type { Metadata } from "next";
import AnnualApp from "@/components/annual/AnnualApp";
import { ORGANIZATION_IDS } from "@/domain/types";
import type { OrganizationId } from "@/domain/types";
import { todayKST } from "@/domain/calendar";

export const metadata: Metadata = {
  title: "연간계획 입력 | 예봄일정",
  description:
    "예봄교회 부서별 연간계획을 비공개 초안으로 저장하고 검토 후 일괄 등록합니다.",
};

export default async function AnnualPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const candidateYear =
    typeof params.year === "string" ? Number(params.year) : NaN;
  const year =
    Number.isInteger(candidateYear) &&
    candidateYear >= 2000 &&
    candidateYear <= 2100
      ? candidateYear
      : Number(todayKST().slice(0, 4));
  const org =
    typeof params.org === "string" &&
    ORGANIZATION_IDS.includes(params.org as OrganizationId)
      ? (params.org as OrganizationId)
      : null;
  return <AnnualApp initialYear={year} initialOrganization={org} />;
}
