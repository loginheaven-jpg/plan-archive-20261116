import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  FilePlus2,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { ORGANIZATIONS, organization } from "@/domain/organizations";
import type { Actor, AnnualDraftSummary, OrganizationId } from "@/domain/types";
import { workspaceDirty, type Workspace } from "./workspace";

export function annualStamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export default function AnnualSidebar({
  workspace,
  actor,
  allowedIds,
  mayEdit,
  busy,
  loading,
  inputReady,
  drafts,
  draftError,
  parked,
  onYear,
  onOrganization,
  onNew,
  onRefresh,
  onResume,
  onRestore,
}: {
  workspace: Workspace;
  actor: Actor | null;
  allowedIds: OrganizationId[];
  mayEdit: boolean;
  busy: boolean;
  loading: boolean;
  inputReady: boolean;
  drafts: AnnualDraftSummary[];
  draftError: string;
  parked: Workspace[];
  onYear: (year: number) => void;
  onOrganization: (id: OrganizationId | "") => void;
  onNew: () => void;
  onRefresh: () => void;
  onResume: (id: string) => void;
  onRestore: (workspace: Workspace) => void;
}) {
  return (
    <aside className="annual-sidebar" aria-label="연간계획 설정">
      <Link href="/" className="brand">
        <CalendarDays size={34} color="var(--green)" aria-hidden="true" />
        <span>
          <strong>예봄일정</strong>
          <small>교회의 시간을 함께 세워요</small>
        </span>
      </Link>
      <nav className="side-nav">
        <Link href={`/?year=${workspace.year}&view=list`}>
          <ArrowLeft size={18} />
          일정으로 돌아가기
        </Link>
        <span className="annual-active-nav">
          <FilePlus2 size={18} />
          연간계획 입력
        </span>
      </nav>
      <label className="field">
        <span>계획 연도</span>
        <select
          value={workspace.year}
          disabled={busy}
          onChange={(e) => onYear(Number(e.target.value))}
        >
          {Array.from({ length: 101 }, (_, i) => 2000 + i).map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>새 행의 입력 부서</span>
        <select
          value={workspace.organizationId}
          disabled={!mayEdit || busy}
          onChange={(e) =>
            onOrganization(e.target.value as OrganizationId | "")
          }
        >
          <option value="">한 부서를 선택해 주세요</option>
          {ORGANIZATIONS.filter(
            (o) =>
              allowedIds.includes(o.id) || o.id === workspace.organizationId,
          ).map((o) => (
            <option
              value={o.id}
              disabled={!allowedIds.includes(o.id)}
              key={o.id}
            >
              {o.name}
              {o.id === "admin" ? " (당회)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="annual-side-note">
        조회 필터와 별개인 <strong>한 부서</strong>입니다. 바꾸면 앞으로 추가할
        행에만 적용해요. 이미 쓴 행의 주관부서는 바뀌지 않아요.
      </p>
      <div className="annual-defaults">
        <LockKeyhole size={17} />
        <span>
          새 행 기본값
          <br />
          <strong>로그인 성도 공개 · 선택 부서 대상</strong>
        </span>
      </div>
      <button className="button" disabled={!inputReady || busy} onClick={onNew}>
        <FilePlus2 size={17} />새 개인 초안
      </button>
      <section className="annual-draft-list">
        <h2>
          내 서버 초안{" "}
          <button
            className="icon-button"
            aria-label="서버 초안 목록 새로 읽기"
            disabled={busy || loading}
            onClick={onRefresh}
          >
            <RefreshCw size={16} />
          </button>
        </h2>
        <p>로그인 사용자만 볼 수 있어요.</p>
        {draftError && (
          <p className="annual-error-text" role="alert">
            {draftError}
          </p>
        )}
        {!loading && actor && mayEdit && drafts.length === 0 && !draftError && (
          <p>이 연도의 저장된 초안이 없어요.</p>
        )}
        {drafts.map((draft) => (
          <button
            className={`annual-draft-item ${draft.id === workspace.id ? "active" : ""}`}
            key={draft.id}
            disabled={busy || !mayEdit}
            onClick={() => onResume(draft.id)}
          >
            <strong>
              {organization(draft.organizationId).name} · {draft.rowCount}행
            </strong>
            <small>
              {annualStamp(draft.updatedAt)} · 등록 {draft.publishedCount}개
            </small>
            {draft.id === workspace.id && (
              <span>현재 초안 · 개정 {draft.version}</span>
            )}
          </button>
        ))}
      </section>
      {!!parked.length && (
        <section className="annual-draft-list">
          <h2>이 세션의 작성 중 입력</h2>
          <p>서버 저장 전에는 브라우저를 닫으면 사라져요.</p>
          {parked.map((saved) => (
            <button
              className="annual-draft-item"
              key={saved.key}
              disabled={busy}
              onClick={() => onRestore(saved)}
            >
              <strong>
                {saved.year}년 ·{" "}
                {saved.organizationId
                  ? organization(saved.organizationId).name
                  : "부서 미선택"}
              </strong>
              <small>
                {saved.rows.length}행 ·{" "}
                {workspaceDirty(saved)
                  ? "서버에 저장되지 않은 변경 있음"
                  : "저장한 입력"}
              </small>
            </button>
          ))}
        </section>
      )}
    </aside>
  );
}
