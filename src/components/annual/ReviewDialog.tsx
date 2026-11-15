import { useMemo, useState } from "react";
import Dialog from "@/components/calendar/Dialog";
import { dateLabel, timeLabel } from "@/domain/calendar";
import { recurrenceLabel } from "@/domain/annual";
import { organization } from "@/domain/organizations";
import type { RowReview } from "./review";

export default function ReviewDialog({
  reviews,
  year,
  pending,
  error,
  onClose,
  onPublish,
}: {
  reviews: RowReview[];
  year: number;
  pending: boolean;
  error: string;
  onClose: () => void;
  onPublish: (rowIds: string[]) => Promise<void>;
}) {
  const valid = useMemo(
    () =>
      reviews.filter(
        (r) => r.input && !r.undated && !r.errors.length && r.firstDate,
      ),
    [reviews],
  );
  const [selected, setSelected] = useState(() => valid.map((r) => r.row.id));
  const [confirmed, setConfirmed] = useState(false);
  const chosen = valid.filter((r) => selected.includes(r.row.id));
  const toggle = (id: string) => {
    setSelected((p) =>
      p.includes(id) ? p.filter((v) => v !== id) : [...p, id],
    );
    setConfirmed(false);
  };
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <Dialog
      wide
      title="달력 등록 전 검토"
      description="선택한 유효 행만 한 번에 등록합니다. 날짜 미정과 오류 행은 비공개 초안에 남아요."
      onClose={close}
    >
      <div className="annual-dialog dialog-body">
        <div className="annual-review-summary">
          <strong>{chosen.length}개 활동 등록 예정</strong>
          <span>
            {chosen.filter((r) => r.input?.visibility === "public").length}개
            전체 공개 ·{" "}
            {chosen.filter((r) => r.input?.visibility !== "public").length}개
            내부 공개
          </span>
        </div>
        <p className="annual-note">
          반복 겹침 검토 구간:{" "}
          <strong>
            {year}-01-01 ~ {year}-12-31 (유한 1년)
          </strong>
          . 열람 가능한 일정만 비교합니다. 교회력은 실제 행사/휴무가 아닌
          참고이며, 이후 연도나 열람 불가능한 일정의 충돌 여부를 이 화면에서
          보장하지 않아요. 서버가 등록 직전에 권한·장소·전체 행을 다시
          확인합니다.
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            disabled={pending || !valid.length}
            checked={valid.length > 0 && selected.length === valid.length}
            onChange={(e) => {
              setSelected(e.target.checked ? valid.map((r) => r.row.id) : []);
              setConfirmed(false);
            }}
          />
          유효한 활동 모두 선택 ({valid.length}개)
        </label>
        {reviews.map((review) => {
          const selectable = valid.some((r) => r.row.id === review.row.id);
          const input = review.input;
          return (
            <article
              className={`annual-review-row ${selectable ? "" : "annual-review-blocked"}`}
              key={review.row.id}
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selected.includes(review.row.id)}
                  disabled={!selectable || pending}
                  onChange={() => toggle(review.row.id)}
                />
                <strong>{review.row.input.title || "제목 없음"}</strong>
              </label>
              {review.undated ? (
                <p>
                  <strong>날짜 미정 · 초안 유지</strong>
                </p>
              ) : (
                review.firstDate && (
                  <p>
                    실제 첫 회차: <strong>{dateLabel(review.firstDate)}</strong>
                    {input && ` · ${timeLabel(input)}`}
                    <br />
                    {input?.recurrence &&
                      `${recurrenceLabel(input)} · 이 해 ${review.occurrenceCount}회`}
                  </p>
                )
              )}
              {input && (
                <p>
                  주관:{" "}
                  <strong>{organization(input.organizationId).name}</strong> ·
                  대상:{" "}
                  {input.audience === "all"
                    ? "전교회 · 전체 성도"
                    : input.audienceIds
                        .map((id) => organization(id).name)
                        .join(", ")}
                  <br />
                  공개:{" "}
                  <strong>
                    {input.visibility === "public"
                      ? "전체 공개 · 외부 공유 / 구글 구독 포함"
                      : input.visibility === "members"
                        ? "로그인 성도에게만"
                        : "주관부서 담당자에게만"}
                  </strong>{" "}
                  · {input.location || "장소 미정"}
                </p>
              )}
              {review.errors.length > 0 && (
                <ul className="annual-row-errors">
                  {review.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
              {review.warnings.length > 0 && (
                <details open>
                  <summary>확인할 내용 ({review.warnings.length})</summary>
                  <ul className="annual-row-warnings">
                    {review.warnings.slice(0, 12).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  {review.warnings.length > 12 && (
                    <p>
                      외 {review.warnings.length - 12}건. 반복 일정의 전체
                      회차를 별도로 확인해 주세요.
                    </p>
                  )}
                </details>
              )}
              {review.references.length > 0 && (
                <details>
                  <summary>
                    같은 날짜의 전교회 행사 · 교회력 참고 (
                    {review.references.length})
                  </summary>
                  <ul>
                    {review.references.map((ref, i) => (
                      <li key={i}>{ref}</li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
        <div className="alert">
          등록은 전부 성공하거나 전부 취소됩니다. 등록 완료 행은 이 초안에서
          변경·삭제할 수 없고 원본 일정에서 수정해요.
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            disabled={pending || !chosen.length}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            선택한 {chosen.length}개 활동의 날짜·주관부서·참여 대상·공개 범위와
            경고를 확인했어요
          </span>
        </label>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className="dialog-actions">
        <button className="button" disabled={pending} onClick={close}>
          입력표로 돌아가기
        </button>
        <button
          className="button primary"
          disabled={pending || !confirmed || !chosen.length}
          onClick={() => void onPublish(chosen.map((r) => r.row.id))}
        >
          {pending
            ? "전체 확인하고 등록 중…"
            : `${chosen.length}개 활동 달력에 등록`}
        </button>
      </footer>
    </Dialog>
  );
}
