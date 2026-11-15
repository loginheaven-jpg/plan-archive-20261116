"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ClipboardPaste,
  Copy,
  LockKeyhole,
  LogIn,
  Save,
  UserRound,
} from "lucide-react";
import { api } from "@/components/calendar/api";
import { newAnnualRow } from "@/domain/annual";
import { churchYear } from "@/domain/church-year";
import { canCreate, canEditEvent } from "@/domain/permissions";
import { ORGANIZATIONS } from "@/domain/organizations";
import type {
  AnnualDraft,
  AnnualDraftSummary,
  AnnualPlanRow,
  Bootstrap,
  OrganizationId,
} from "@/domain/types";
import AnnualSidebar, { annualStamp as stamp } from "./AnnualSidebar";
import WorkspaceDialogs, { type DraftConflict } from "./WorkspaceDialogs";
import AnnualTable from "./AnnualTable";
import RowDetails from "./RowDetails";
import PasteDialog from "./PasteDialog";
import PreviousYearDialog from "./PreviousYearDialog";
import ReviewDialog from "./ReviewDialog";
import { reviewRows, type RowReview } from "./review";
import {
  AnnualApiError,
  createDraft,
  getDraft,
  listDrafts,
  publishDraft,
  saveDraft,
} from "./api";
import {
  blankWorkspace,
  fromDraft,
  workspaceDirty,
  workspaceInput,
  type Workspace,
} from "./workspace";
import { useUnsavedGuard } from "./useUnsavedGuard";
import "./annual.css";

export default function AnnualApp({
  initialYear,
  initialOrganization,
}: {
  initialYear: number;
  initialOrganization: OrganizationId | null;
}) {
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    blankWorkspace(initialYear),
  );
  const [parked, setParked] = useState<Workspace[]>([]);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [drafts, setDrafts] = useState<AnnualDraftSummary[]>([]);
  const [draftError, setDraftError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [previousOpen, setPreviousOpen] = useState(false);
  const [reviews, setReviews] = useState<RowReview[] | null>(null);
  const [publishError, setPublishError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [yearTarget, setYearTarget] = useState<number | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const initialOrgApplied = useRef(false);
  const loadGeneration = useRef(0);
  const actor = boot?.actor ?? null;
  const allowedIds = useMemo(
    () =>
      !actor || !canCreate(actor)
        ? []
        : actor.role === "admin"
          ? ORGANIZATIONS.map((o) => o.id)
          : ORGANIZATIONS.filter((o) => actor.departmentIds.includes(o.id)).map(
              (o) => o.id,
            ),
    [actor],
  );
  const mayEdit = !loading && !loadError && canCreate(actor);
  const dirty = workspaceDirty(workspace);
  const parkedDirtyCount = parked.filter(workspaceDirty).length;
  const guard = useUnsavedGuard(dirty || parkedDirtyCount > 0, busy);
  const inputReady =
    mayEdit &&
    !!workspace.organizationId &&
    allowedIds.includes(workspace.organizationId);
  const detailRow = workspace.rows.find((row) => row.id === detailsId);

  const load = useCallback(async (year: number) => {
    const data = await api<Bootstrap>(`/api/bootstrap?year=${year}`);
    return data;
  }, []);
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const generation = ++loadGeneration.current;
    const current = () => generation === loadGeneration.current;
    // Drop account-scoped data before awaiting; the unsaved workspace stays separate.
    setDrafts([]);
    setDraftError("");
    setBoot(null);
    setLoading(true);
    try {
      const data = await load(workspace.year);
      if (!current()) return;
      setBoot(data);
      setLoadError("");
      const allowed =
        data.actor && canCreate(data.actor)
          ? data.actor.role === "admin"
            ? ORGANIZATIONS.map((o) => o.id)
            : data.actor.departmentIds
          : [];
      if (!initialOrgApplied.current) {
        initialOrgApplied.current = true;
        if (initialOrganization && allowed.includes(initialOrganization))
          setWorkspace((p) => ({ ...p, organizationId: initialOrganization }));
        else if (initialOrganization)
          setNotice(
            "전달된 부서에 입력 권한이 없어요. 담당 부서를 직접 선택해 주세요.",
          );
      }
      if (data.actor && canCreate(data.actor)) {
        try {
          const result = await listDrafts(workspace.year);
          if (!current()) return;
          setDrafts(result.drafts.filter((d) => d.ownerId === data.actor?.id));
          setDraftError("");
        } catch (e) {
          if (current())
            setDraftError(
              e instanceof Error ? e.message : "초안 목록을 읽지 못했어요.",
            );
        }
      }
    } catch (e) {
      if (current()) {
        setBoot(null);
        setLoadError(e instanceof Error ? e.message : "연결을 확인해 주세요.");
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [load, workspace.year, initialOrganization]);

  useEffect(() => {
    const refreshSession = () => void refresh();
    const invalidate = () => {
      ++loadGeneration.current;
    };
    void refresh();
    window.addEventListener("yebom:session-changed", refreshSession);
    return () => {
      // Invalidate initial, manual, and session requests on unmount/year change.
      invalidate();
      window.removeEventListener("yebom:session-changed", refreshSession);
    };
  }, [refresh]);

  const parkCurrent = (current = workspace) => {
    if (current.rows.length || current.id)
      setParked((p) => [...p.filter((w) => w.key !== current.key), current]);
  };
  const adopt = (draft: AnnualDraft, key = workspace.key): Workspace => {
    const next = { ...fromDraft(draft), key };
    setWorkspace(next);
    const summary: AnnualDraftSummary = {
      id: draft.id,
      version: draft.version,
      ownerId: draft.ownerId,
      year: draft.year,
      organizationId: draft.organizationId,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      rowCount: draft.rows.length,
      publishedCount: draft.publishedRowIds.length,
    };
    setDrafts((p) => [summary, ...p.filter((d) => d.id !== draft.id)]);
    return next;
  };
  const beginBusy = () => {
    busyRef.current = true;
    setBusy(true);
    setError("");
  };
  const endBusy = () => {
    busyRef.current = false;
    setBusy(false);
  };
  const checkDraftOwner = (draft: AnnualDraft) => {
    if (!actor || draft.ownerId !== actor.id)
      throw new Error(
        "현재 로그인 사용자의 개인 초안이 아니에요. 계정과 권한을 다시 확인해 주세요.",
      );
  };
  const save = async (current = workspace): Promise<Workspace | null> => {
    if (!mayEdit || busyRef.current) return null;
    const input = workspaceInput(current);
    if (!input || !allowedIds.includes(input.organizationId)) {
      setError("저장할 입력 부서를 하나 선택해 주세요.");
      return null;
    }
    if (!workspaceDirty(current) && current.id) return current;
    const creationId = current.creationId ?? crypto.randomUUID();
    setWorkspace((p) => (p.key === current.key ? { ...p, creationId } : p));
    beginBusy();
    try {
      const result = current.id
        ? await saveDraft(current.id, current.version, input)
        : await createDraft(creationId, input);
      checkDraftOwner(result.draft);
      const next = adopt(result.draft, current.key);
      setNotice(
        `개인 초안을 서버에 저장했어요. ${stamp(result.draft.updatedAt)} · 달력에는 아직 등록하지 않았어요.`,
      );
      return next;
    } catch (e) {
      if (e instanceof AnnualApiError && e.status === 409)
        setConflict({
          message: e.message,
          latest: null,
          loading: false,
          error: "",
        });
      else
        setError(
          e instanceof Error
            ? e.message
            : "저장하지 못했어요. 입력은 그대로 유지됩니다.",
        );
      return null;
    } finally {
      endBusy();
    }
  };
  const changeRow = (next: AnnualPlanRow) => {
    if (
      !mayEdit ||
      busyRef.current ||
      workspace.publishedRowIds.includes(next.id) ||
      !allowedIds.includes(next.input.organizationId)
    )
      return;
    setWorkspace((p) => ({
      ...p,
      rows: p.rows.map((row) =>
        row.id === next.id && !p.publishedRowIds.includes(row.id) ? next : row,
      ),
    }));
  };
  const append = (rows: AnnualPlanRow[]) => {
    if (!inputReady || busyRef.current) return;
    setWorkspace((p) => ({ ...p, rows: [...p.rows, ...rows] }));
    setNotice(
      `${rows.length}행을 입력표 끝에 추가했어요. 초안 저장 버튼으로 서버에 보관해 주세요.`,
    );
  };
  const saveNext = async () => {
    const saved = await save();
    if (!saved || !saved.organizationId) return;
    const nextRow = newAnnualRow(saved.organizationId, saved.year);
    setWorkspace((p) => ({ ...p, rows: [...p.rows, nextRow] }));
    setNotice(
      "개인 초안을 서버에 저장했어요. 같은 연도·입력 부서의 다음 행을 추가했으며, 새 행은 아직 저장 전입니다.",
    );
    requestAnimationFrame(() => {
      document.getElementById(`annual-date-${nextRow.id}`)?.focus();
    });
  };
  const startNew = (year: number, current = workspace) => {
    parkCurrent(current);
    if (year !== workspace.year) {
      setLoading(true);
      setBoot(null);
      setDrafts([]);
    }
    setWorkspace(
      blankWorkspace(year, current.organizationId, crypto.randomUUID()),
    );
    setNotice(
      current.rows.length
        ? "이전 입력은 이 세션의 ‘작성 중 입력’에 그대로 보관했어요. 브라우저를 닫기 전 서버에 저장해 주세요."
        : "새 개인 초안을 시작했어요.",
    );
    setError("");
    setYearTarget(null);
    setNewOpen(false);
  };
  const selectYear = (next: number) => {
    if (next === workspace.year || busyRef.current) return;
    if (workspace.rows.length) setYearTarget(next);
    else startNew(next);
  };
  const resume = async (id: string) => {
    if (!mayEdit || busyRef.current) return;
    beginBusy();
    try {
      const { draft } = await getDraft(id);
      checkDraftOwner(draft);
      parkCurrent();
      adopt(draft, crypto.randomUUID());
      setResumeId(null);
      setNotice(
        "서버의 개인 초안을 불러왔어요. 이전 작성 중 입력도 이 세션에 보관했어요.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "초안을 불러오지 못했어요. 현재 입력은 유지됩니다.",
      );
    } finally {
      endBusy();
    }
  };
  const restoreParked = (saved: Workspace) => {
    if (busyRef.current) return;
    parkCurrent();
    setParked((p) => p.filter((w) => w.key !== saved.key));
    if (workspace.year !== saved.year) {
      setLoading(true);
      setBoot(null);
      setDrafts([]);
    }
    setWorkspace(saved);
    setNotice("작성 중 입력을 복원했어요. 서버 저장 여부를 확인해 주세요.");
    setError("");
  };
  const prepareReview = async () => {
    const saved = await save();
    if (!saved || !saved.id) return;
    beginBusy();
    try {
      const data = await load(saved.year);
      setBoot(data);
      if (!data.actor || !canCreate(data.actor))
        throw new Error(
          "로그인 또는 편집 권한이 변경됐어요. 초안은 저장되어 있습니다. 로그인 상태를 다시 확인해 주세요.",
        );
      const eligible = saved.rows.filter(
        (row) => !saved.publishedRowIds.includes(row.id),
      );
      const result = reviewRows(
        eligible,
        saved.year,
        data.events,
        data.actor,
        churchYear(saved.year, data.settings),
      );
      setReviews(result);
      setPublishError("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "등록 전 검토를 준비하지 못했어요. 초안은 유지됩니다.",
      );
    } finally {
      endBusy();
    }
  };
  const publish = async (rowIds: string[]) => {
    if (!workspace.id || dirty || !mayEdit || busyRef.current) return;
    beginBusy();
    setPublishError("");
    try {
      const result = await publishDraft(
        workspace.id,
        workspace.version,
        rowIds,
      );
      checkDraftOwner(result.draft);
      adopt(result.draft);
      setBoot((p) =>
        p
          ? {
              ...p,
              events: [
                ...p.events.filter(
                  (e) => !result.events.some((n) => n.id === e.id),
                ),
                ...result.events,
              ],
            }
          : p,
      );
      setReviews(null);
      setNotice(
        `${rowIds.length}개 활동을 달력에 등록했어요.${result.warnings.length ? ` 서버 검토 안내: ${result.warnings.join(" · ")}` : ""} 날짜 미정·미선택 행은 개인 초안에 남아 있어요.`,
      );
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "등록하지 못했어요. 선택한 행은 모두 초안으로 유지됩니다.";
      setPublishError(message);
      if (e instanceof AnnualApiError && e.status === 409) {
        setReviews(null);
        setConflict({ message, latest: null, loading: false, error: "" });
      }
    } finally {
      endBusy();
    }
  };
  const inspectConflict = async () => {
    const targetId = workspace.id ?? workspace.creationId;
    if (!targetId || !conflict || conflict.loading) return;
    setConflict((p) => (p ? { ...p, loading: true, error: "" } : p));
    try {
      const { draft } = await getDraft(targetId);
      checkDraftOwner(draft);
      setConflict((p) => (p ? { ...p, latest: draft, loading: false } : p));
    } catch (e) {
      setConflict((p) =>
        p
          ? {
              ...p,
              loading: false,
              error:
                e instanceof Error ? e.message : "최신 초안을 읽지 못했어요.",
            }
          : p,
      );
    }
  };
  const copyConflictAsNew = async () => {
    if (!conflict?.latest || busyRef.current || !mayEdit) return;
    const published = new Set([
      ...workspace.publishedRowIds,
      ...conflict.latest.publishedRowIds,
    ]);
    const remaining = workspace.rows
      .filter((row) => !published.has(row.id))
      .map((row) => ({ ...structuredClone(row), id: crypto.randomUUID() }));
    if (!remaining.length) {
      setError("모든 행이 이미 등록되어 새 초안으로 복사할 행이 없어요.");
      setConflict(null);
      return;
    }
    const current = workspace;
    const next = {
      ...blankWorkspace(
        workspace.year,
        workspace.organizationId,
        crypto.randomUUID(),
      ),
      rows: remaining,
    };
    parkCurrent(current);
    setWorkspace(next);
    setConflict(null);
    await save(next);
  };
  const hiddenSaved = workspace.publishedRowIds.length;
  const unresolvedCount = workspace.rows.length - hiddenSaved;

  return (
    <div className="annual-app app-shell">
      <AnnualSidebar
        workspace={workspace}
        actor={actor}
        allowedIds={allowedIds}
        mayEdit={mayEdit}
        busy={busy}
        loading={loading}
        inputReady={inputReady}
        drafts={drafts}
        draftError={draftError}
        parked={parked}
        onYear={selectYear}
        onOrganization={(id) =>
          setWorkspace((p) => ({ ...p, organizationId: id }))
        }
        onNew={() =>
          workspace.rows.length ? setNewOpen(true) : startNew(workspace.year)
        }
        onRefresh={() => void refresh()}
        onResume={(id) =>
          workspace.rows.length ? setResumeId(id) : void resume(id)
        }
        onRestore={restoreParked}
      />
      <main className="annual-main">
        <header className="topbar">
          <span className="breadcrumb">
            예봄일정 <span>/</span> 연간계획
          </span>
          <span className="signed-user">
            <UserRound size={17} />
            {actor
              ? `${actor.name} · ${actor.role === "admin" ? "일정 관리자" : actor.role === "editor" ? "부서 담당자" : "조회 전용"}`
              : "로그인 / 연결 확인 필요"}
          </span>
        </header>
        <section className="page-heading">
          <div>
            <span className="eyebrow">부서의 한 해를 한눈에</span>
            <h1>{workspace.year}년 연간계획 입력</h1>
            <p>
              날짜와 이름부터 적고, 비공개 초안으로 보관한 뒤 달력에 등록하세요.
            </p>
          </div>
          <Link className="button" href={`/?year=${workspace.year}&view=list`}>
            <ArrowLeft size={17} />
            달력 보기
          </Link>
        </section>
        {loading && (
          <div className="alert" role="status">
            실제 로그인 정보와 {workspace.year}년 일정을 읽고 있어요…
          </div>
        )}
        {loadError && (
          <div className="alert error" role="alert">
            <span>
              {loadError} 실제 사용자와 연결을 확인할 수 없어 입력·저장을 잠시
              막았어요. 작성한 행은 유지됩니다.
            </span>
            <button className="button" onClick={() => void refresh()}>
              연결 다시 확인
            </button>
          </div>
        )}
        {!loading && !loadError && !mayEdit && (
          <section className="annual-readonly">
            <LockKeyhole size={24} />
            <div>
              <h2>
                {actor
                  ? "연간계획 입력 권한이 필요해요"
                  : "실제 교회 계정으로 로그인해 주세요"}
              </h2>
              <p>
                {boot?.auth.message ||
                  "로그인 정보와 서버 연결을 확인할 수 없어 조회 전용으로 표시합니다."}
              </p>
              <p>
                가상 담당자나 임시 계정을 사용하지 않습니다. 실제 부서 담당
                권한이 있는 계정만 개인 초안과 일괄 등록을 사용할 수 있어요.
              </p>
              {!actor && boot?.auth.loginUrl && (
                <a className="button primary" href={boot.auth.loginUrl}>
                  <LogIn size={18} />
                  교회 계정 로그인
                </a>
              )}
            </div>
          </section>
        )}
        {!workspace.organizationId && mayEdit && (
          <div className="alert">
            <strong>왼쪽에서 입력 부서를 하나 선택해 주세요.</strong>
            <span>여러 조회 부서 중 하나를 임의로 선택하지 않아요.</span>
          </div>
        )}
        <div className="annual-help">
          <strong>날짜 표현 예시</strong>
          <span>
            10/10 · 10/10~10/12 · 날짜 미정 · 10/10부터 계속 수요일 오후8시
          </span>
          <span>
            ‘10/10부터 계속 수요일8시’는 오전/오후 확인 후 등록할 수 있어요.
            날짜는 선택 연도, 시각은 한국시간 기준입니다.
          </span>
        </div>
        <div className="annual-toolbar">
          <div className="annual-tool-buttons">
            <button
              className="button"
              disabled={!inputReady || busy}
              onClick={() => setPasteOpen(true)}
            >
              <ClipboardPaste size={18} />표 붙여넣기
            </button>
            <button
              className="button"
              disabled={!inputReady || busy || workspace.year <= 2000}
              onClick={() => setPreviousOpen(true)}
            >
              <Copy size={18} />
              지난해 가져오기
            </button>
          </div>
          <span>
            {workspace.rows.length}행 · 등록 완료 {hiddenSaved}개 ·{" "}
            {workspace.id
              ? `개인 초안 개정 ${workspace.version}`
              : "새 초안 (아직 서버 저장 전)"}
          </span>
        </div>
        {notice && (
          <div className="annual-status" role="status">
            <Check size={18} />
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="알림 닫기"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
            <span>
              입력은 그대로 유지됩니다. 권한·연결·서버 상태를 확인한 뒤 다시
              시도해 주세요.
            </span>
          </div>
        )}
        <AnnualTable
          rows={workspace.rows}
          year={workspace.year}
          venues={boot?.venues ?? []}
          newRowOrganizationId={workspace.organizationId}
          canAdd={inputReady}
          publishedRowIds={workspace.publishedRowIds}
          disabled={!mayEdit || busy}
          onChange={changeRow}
          onDelete={setDeleteId}
          onDetails={setDetailsId}
          onAdd={() => {
            if (workspace.organizationId)
              append([newAnnualRow(workspace.organizationId, workspace.year)]);
          }}
          onSaveNext={() => void saveNext()}
        />
        <footer className="annual-savebar">
          <div>
            <strong>
              {busy
                ? "서버에서 처리 중…"
                : dirty
                  ? "저장되지 않은 변경이 있어요"
                  : workspace.id
                    ? "개인 초안이 서버에 저장되어 있어요"
                    : "서버에 보관하려면 초안 저장을 누르세요"}
            </strong>
            <span>초안은 공개 달력과 구글 구독에 나타나지 않아요.</span>
          </div>
          <div>
            <button
              className="button"
              disabled={!inputReady || busy}
              onClick={() => void save()}
            >
              <Save size={18} />
              초안 저장
            </button>
            <button
              className="button primary"
              disabled={!inputReady || busy || !unresolvedCount}
              onClick={() => void prepareReview()}
            >
              저장 후 등록 검토
            </button>
          </div>
        </footer>
        <p className="annual-footer-note">
          입력자·일정수립일은 실제 등록 시 서버에서 기록합니다. 모든 행은 등록
          전까지 개인 초안이며, 날짜 미정 행은 계속 초안으로 남아요.
        </p>
      </main>
      {detailRow && (
        <RowDetails
          key={detailRow.id}
          row={detailRow}
          year={workspace.year}
          allowedIds={allowedIds}
          readOnly={
            !mayEdit ||
            workspace.publishedRowIds.includes(detailRow.id) ||
            !canEditEvent(detailRow.input, actor)
          }
          onClose={() => setDetailsId(null)}
          onApply={changeRow}
        />
      )}
      {pasteOpen && workspace.organizationId && (
        <PasteDialog
          year={workspace.year}
          organizationId={workspace.organizationId}
          allowedIds={allowedIds}
          onClose={() => setPasteOpen(false)}
          onAppend={append}
        />
      )}
      {previousOpen && workspace.organizationId && actor && (
        <PreviousYearDialog
          targetYear={workspace.year}
          organizationId={workspace.organizationId}
          actor={actor}
          onClose={() => setPreviousOpen(false)}
          onAppend={append}
        />
      )}
      {reviews && (
        <ReviewDialog
          reviews={reviews}
          year={workspace.year}
          pending={busy}
          error={publishError}
          onClose={() => {
            if (!busy) setReviews(null);
          }}
          onPublish={publish}
        />
      )}
      <WorkspaceDialogs
        workspace={workspace}
        busy={busy}
        inputReady={inputReady}
        deleteId={deleteId}
        yearTarget={yearTarget}
        newOpen={newOpen}
        resumeId={resumeId}
        destination={guard.destination}
        parkedDirtyCount={parkedDirtyCount}
        conflict={conflict}
        onCloseDelete={() => setDeleteId(null)}
        onDelete={() => {
          if (
            deleteId &&
            !busy &&
            mayEdit &&
            !workspace.publishedRowIds.includes(deleteId)
          )
            setWorkspace((p) => ({
              ...p,
              rows: p.rows.filter((r) => r.id !== deleteId),
            }));
          setDeleteId(null);
        }}
        onCloseNew={() => {
          if (!busy) {
            setYearTarget(null);
            setNewOpen(false);
          }
        }}
        onNew={() => startNew(yearTarget ?? workspace.year)}
        onSaveNew={() => {
          void (async () => {
            const saved = await save();
            if (saved) startNew(yearTarget ?? workspace.year, saved);
          })();
        }}
        onCloseResume={() => {
          if (!busy) setResumeId(null);
        }}
        onResume={() => {
          if (resumeId) void resume(resumeId);
        }}
        onCancelLeave={guard.cancel}
        onLeave={guard.leave}
        onSaveLeave={() => {
          void (async () => {
            const saved = await save();
            if (saved) {
              if (parkedDirtyCount > 0) guard.cancel();
              else guard.leave();
            }
          })();
        }}
        onCloseConflict={() => {
          if (!conflict?.loading && !busy) setConflict(null);
        }}
        onInspectConflict={() => void inspectConflict()}
        onLoadConflict={() => {
          if (conflict?.latest) {
            parkCurrent();
            adopt(conflict.latest, crypto.randomUUID());
            setConflict(null);
          }
        }}
        onCopyConflict={() => void copyConflictAsNew()}
      />
    </div>
  );
}
