import Dialog from "@/components/calendar/Dialog";
import type { AnnualDraft } from "@/domain/types";
import type { Workspace } from "./workspace";
import { annualStamp } from "./AnnualSidebar";

export interface DraftConflict {
  message: string;
  latest: AnnualDraft | null;
  loading: boolean;
  error: string;
}

export default function WorkspaceDialogs({
  workspace,
  busy,
  inputReady,
  deleteId,
  yearTarget,
  newOpen,
  resumeId,
  destination,
  parkedDirtyCount,
  conflict,
  onCloseDelete,
  onDelete,
  onCloseNew,
  onNew,
  onSaveNew,
  onCloseResume,
  onResume,
  onCancelLeave,
  onLeave,
  onSaveLeave,
  onCloseConflict,
  onInspectConflict,
  onLoadConflict,
  onCopyConflict,
}: {
  workspace: Workspace;
  busy: boolean;
  inputReady: boolean;
  deleteId: string | null;
  yearTarget: number | null;
  newOpen: boolean;
  resumeId: string | null;
  destination: string | null;
  parkedDirtyCount: number;
  conflict: DraftConflict | null;
  onCloseDelete: () => void;
  onDelete: () => void;
  onCloseNew: () => void;
  onNew: () => void;
  onSaveNew: () => void;
  onCloseResume: () => void;
  onResume: () => void;
  onCancelLeave: () => void;
  onLeave: () => void;
  onSaveLeave: () => void;
  onCloseConflict: () => void;
  onInspectConflict: () => void;
  onLoadConflict: () => void;
  onCopyConflict: () => void;
}) {
  return (
    <>
      {deleteId && (
        <Dialog
          title="이 행을 삭제할까요?"
          description="등록된 행은 삭제하지 않습니다. 이 작업은 초안 저장 전까지 서버에 반영되지 않아요."
          onClose={onCloseDelete}
        >
          <div className="dialog-body">
            <p>
              {workspace.rows.find((r) => r.id === deleteId)?.input.title ||
                "이 초안 행"}
              의 입력을 제거합니다.
            </p>
          </div>
          <footer className="dialog-actions">
            <button className="button" disabled={busy} onClick={onCloseDelete}>
              유지
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={onDelete}
            >
              행 삭제
            </button>
          </footer>
        </Dialog>
      )}
      {(yearTarget !== null || newOpen) && (
        <Dialog
          title={
            yearTarget !== null
              ? "다른 연도의 새 초안을 시작할까요?"
              : "새 개인 초안을 시작할까요?"
          }
          description="현재 행의 연도를 일괄 바꾸지 않아요. 현재 입력은 이 세션에 그대로 유지하고 새 입력표를 열어요."
          onClose={onCloseNew}
        >
          <div className="dialog-body">
            <p>
              현재 {workspace.year}년 {workspace.rows.length}행은 ‘이 세션의
              작성 중 입력’에서 다시 열 수 있어요. 저장 전 입력은 브라우저를
              닫으면 사라지므로 서버에 저장하는 것을 권장해요.
            </p>
          </div>
          <footer className="dialog-actions">
            <button className="button" disabled={busy} onClick={onCloseNew}>
              현재 입력 계속
            </button>
            <button className="button" disabled={busy} onClick={onNew}>
              입력 유지하고 새 초안
            </button>
            <button
              className="button primary"
              disabled={busy || !inputReady}
              onClick={onSaveNew}
            >
              저장하고 새 초안
            </button>
          </footer>
        </Dialog>
      )}
      {resumeId && (
        <Dialog
          title="저장된 개인 초안을 불러올까요?"
          description="현재 작성 중 입력은 이 세션에 유지합니다. 서버 초안은 최신 개정으로 읽어 와요."
          onClose={onCloseResume}
        >
          <div className="dialog-body">
            <p>
              현재 입력을 서버에 저장하지 않았다면 브라우저를 닫기 전에 다시
              열어 저장해 주세요.
            </p>
          </div>
          <footer className="dialog-actions">
            <button className="button" disabled={busy} onClick={onCloseResume}>
              취소
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={onResume}
            >
              입력 유지하고 불러오기
            </button>
          </footer>
        </Dialog>
      )}
      {destination && (
        <Dialog
          title="저장하지 않은 입력이 있어요"
          description="페이지를 떠나면 서버에 저장하지 않은 변경과 이 세션의 작성 중 입력이 사라질 수 있어요."
          onClose={onCancelLeave}
        >
          <div className="dialog-body">
            <p>
              현재 입력을 초안으로 저장한 뒤 이동하거나, 이 화면에서 계속 작성할
              수 있어요.
            </p>
            {parkedDirtyCount > 0 && (
              <p className="alert">
                다른 작성 중 입력 {parkedDirtyCount}개에도 저장되지 않은 변경이
                있어요. 왼쪽에서 각각 다시 열어 저장한 뒤 이동해 주세요.
              </p>
            )}
          </div>
          <footer className="dialog-actions">
            <button className="button" disabled={busy} onClick={onCancelLeave}>
              계속 작성
            </button>
            <button className="button danger" disabled={busy} onClick={onLeave}>
              저장하지 않고 이동
            </button>
            <button
              className="button primary"
              disabled={busy || !inputReady}
              onClick={onSaveLeave}
            >
              {parkedDirtyCount > 0
                ? "현재 초안 저장하고 유지"
                : "저장하고 이동"}
            </button>
          </footer>
        </Dialog>
      )}
      {conflict && (
        <Dialog
          wide
          title="서버 초안이 다른 곳에서 변경됐어요"
          description="내 입력을 조용히 덮어쓰지 않습니다. 현재 입력은 유지한 채 최신 서버 초안을 확인하고 선택하세요."
          onClose={onCloseConflict}
        >
          <div className="annual-dialog dialog-body">
            <p className="alert error">{conflict.message}</p>
            <p>
              내 초안 개정: {workspace.version} · {workspace.rows.length}행.
              다른 탭에서 저장·등록했을 수 있어요.
            </p>
            <button
              className="button"
              disabled={conflict.loading || busy}
              onClick={onInspectConflict}
            >
              {conflict.loading ? "최신 초안 읽는 중…" : "최신 서버 초안 확인"}
            </button>
            {conflict.error && (
              <p className="alert error" role="alert">
                {conflict.error}
              </p>
            )}
            {conflict.latest && (
              <>
                <h3>서버 최신 개정 {conflict.latest.version}</h3>
                <p>
                  {annualStamp(conflict.latest.updatedAt)} ·{" "}
                  {conflict.latest.rows.length}행 · 등록 완료{" "}
                  {conflict.latest.publishedRowIds.length}개
                </p>
                <ul className="annual-conflict-rows">
                  {conflict.latest.rows.map((row) => (
                    <li key={row.id}>
                      {row.input.title || "제목 없음"} ·{" "}
                      {row.dateText || "날짜 미정"}
                      {conflict.latest?.publishedRowIds.includes(row.id)
                        ? " · 등록 완료"
                        : ""}
                    </li>
                  ))}
                </ul>
                <p>
                  최신 초안을 불러와도 내 입력을 이 세션에 보관합니다. 새
                  초안으로 저장하면 아직 등록되지 않은 행만 새 ID로 복사하며,
                  이미 등록된 행은 제외합니다.
                </p>
              </>
            )}
          </div>
          <footer className="dialog-actions">
            <button
              className="button"
              disabled={busy || conflict.loading}
              onClick={onCloseConflict}
            >
              내 입력 유지
            </button>
            <button
              className="button"
              disabled={!conflict.latest || busy || conflict.loading}
              onClick={onLoadConflict}
            >
              최신 초안 불러오기
            </button>
            <button
              className="button primary"
              disabled={!conflict.latest || busy || conflict.loading}
              onClick={onCopyConflict}
            >
              미등록 입력을 새 초안으로 저장
            </button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
