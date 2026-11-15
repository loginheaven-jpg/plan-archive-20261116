import { useMemo, useState } from "react";
import Dialog from "@/components/calendar/Dialog";
import { newAnnualRow, rowToEventInput } from "@/domain/annual";
import { ORGANIZATIONS } from "@/domain/organizations";
import type { AnnualPlanRow, OrganizationId } from "@/domain/types";

import { readPaste } from "./paste";

const COLUMNS = ["날짜", "제목", "장소", "시간", "주관부서 ID"] as const;
type Mapping = Record<(typeof COLUMNS)[number], number>;

export default function PasteDialog({
  year,
  organizationId,
  allowedIds,
  onClose,
  onAppend,
}: {
  year: number;
  organizationId: OrganizationId;
  allowedIds: OrganizationId[];
  onClose: () => void;
  onAppend: (rows: AnnualPlanRow[]) => void;
}) {
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState("auto");
  const [header, setHeader] = useState(true);
  const [mapping, setMapping] = useState<Mapping>({
    날짜: 0,
    제목: 1,
    장소: 2,
    시간: -1,
    "주관부서 ID": -1,
  });
  const [confirmed, setConfirmed] = useState(false);
  const table = useMemo(() => {
    try {
      return { cells: readPaste(text, delimiter), error: "" };
    } catch (e) {
      return {
        cells: [] as string[][],
        error:
          e instanceof Error
            ? e.message
            : "표를 읽지 못했어요. 구분자와 따옴표를 확인해 주세요.",
      };
    }
  }, [text, delimiter]);
  const width = Math.max(0, ...table.cells.map((r) => r.length));
  const source = header ? table.cells.slice(1) : table.cells;
  const preview = useMemo(
    () =>
      source.map((cells, index) => {
        const get = (key: keyof Mapping) =>
          mapping[key] >= 0 ? (cells[mapping[key]] ?? "").trim() : "";
        const orgText = get("주관부서 ID");
        const org = orgText
          ? ORGANIZATIONS.find(
              (o) => o.id === orgText && allowedIds.includes(o.id),
            )?.id
          : organizationId;
        const date = get("날짜");
        const time = get("시간");
        const row = newAnnualRow(org ?? organizationId, year);
        row.dateText = `${date}${time ? ` ${time}` : ""}`.trim();
        row.input.title = get("제목");
        row.input.location = get("장소");
        const parsed = rowToEventInput(row, year);
        const errors = [...parsed.errors];
        if (!org)
          errors.push(
            `주관부서 '${orgText}'는 검증된 권한 범위의 조직 ID가 아니에요.`,
          );
        const formula = cells.some((cell) => /^[=+@]/.test(cell.trim()));
        return {
          row,
          errors,
          index,
          formula,
          invalidOrg: !org,
          undated: parsed.undated,
        };
      }),
    [source, mapping, allowedIds, organizationId, year],
  );
  const resetConfirm = () => setConfirmed(false);
  const close = () => {
    if (
      !text.trim() ||
      window.confirm(
        "붙여넣기를 닫을까요? 아직 입력표에 추가되지 않은 내용은 버려집니다.",
      )
    )
      onClose();
  };
  const requiredMapping =
    mapping.날짜 >= 0 && mapping.제목 >= 0 && mapping.날짜 !== mapping.제목;
  return (
    <Dialog
      wide
      title="엑셀 · 표 붙여넣기"
      description="텍스트를 넣고 열을 연결하세요. 미리보기를 확인한 행만 입력표 끝에 추가하며 수식이나 코드는 실행하지 않습니다."
      onClose={close}
    >
      <div className="annual-dialog dialog-body">
        <label className="field">
          <span>표 텍스트</span>
          <textarea
            autoFocus
            rows={7}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              resetConfirm();
            }}
            placeholder={
              "날짜\t제목\t장소\n10/10\t어린이 가을 나들이\t교회\n날짜 미정\t교사 연수\t"
            }
          />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>구분자</span>
            <select
              value={delimiter}
              onChange={(e) => {
                setDelimiter(e.target.value);
                resetConfirm();
              }}
            >
              <option value="auto">자동 (TSV / CSV)</option>
              <option value="tab">탭 (TSV)</option>
              <option value="comma">쉼표 (CSV)</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={header}
              onChange={(e) => {
                setHeader(e.target.checked);
                resetConfirm();
              }}
            />
            첫 행은 열 이름 (추가하지 않음)
          </label>
        </div>
        {table.error && (
          <p className="alert error" role="alert">
            {table.error}
          </p>
        )}
        {width > 0 && (
          <>
            <h3>어느 열을 사용할까요?</h3>
            <div className="annual-mapping">
              {COLUMNS.map((key) => (
                <label className="field" key={key}>
                  <span>
                    {key}
                    {key === "날짜" || key === "제목" ? " (필수)" : " (선택)"}
                  </span>
                  <select
                    value={mapping[key] < width ? mapping[key] : -1}
                    onChange={(e) => {
                      setMapping((p) => ({
                        ...p,
                        [key]: Number(e.target.value),
                      }));
                      resetConfirm();
                    }}
                  >
                    <option value={-1}>사용 안 함</option>
                    {Array.from({ length: width }, (_, i) => (
                      <option key={i} value={i}>
                        {i + 1}열
                        {header
                          ? ` · ${table.cells[0]?.[i] || "이름 없음"}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="annual-note">
              부서 열에는 실제 ID만 사용할 수 있어요:{" "}
              {ORGANIZATIONS.filter((o) => allowedIds.includes(o.id))
                .map((o) => `${o.id} (${o.name})`)
                .join(", ")}
              . 빈 부서는 현재 입력 부서를 사용해요. 시간이 있으면 20:00 또는
              오후8시처럼 명확하게 적으세요.
            </p>
            <h3>추가될 {preview.length}행 미리보기</h3>
            <div className="annual-paste-preview">
              {preview.map((p) => (
                <article key={p.index}>
                  <strong>
                    {p.index + 1}. {p.row.input.title || "제목 없음"}
                  </strong>
                  <p>
                    {p.row.dateText || "날짜 미정"} ·{" "}
                    {p.row.input.location || "장소 미정"}
                  </p>
                  {p.undated && (
                    <span className="annual-badge">날짜 미정 · 등록 제외</span>
                  )}
                  {p.errors.map((error, i) => (
                    <p className="annual-error-text" key={i}>
                      {error}
                    </p>
                  ))}
                  {p.formula && (
                    <p>
                      수식처럼 보이는 값도 실행하지 않고 일반 텍스트로
                      보관합니다.
                    </p>
                  )}
                </article>
              ))}
            </div>
            <p className="annual-note">
              날짜·제목 오류가 있는 행도 수정 가능한 초안으로 추가할 수 있어요.
              권한 없는 부서 ID가 있으면 추가를 차단합니다.
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              열 연결과 미리보기를 확인했어요
            </label>
          </>
        )}
      </div>
      <footer className="dialog-actions">
        <button className="button" onClick={close}>
          취소
        </button>
        <button
          className="button primary"
          disabled={
            !confirmed ||
            !requiredMapping ||
            !preview.length ||
            preview.some((p) => p.invalidOrg) ||
            !!table.error
          }
          onClick={() => {
            onAppend(preview.map((p) => p.row));
            onClose();
          }}
        >
          {preview.length}행 추가
        </button>
      </footer>
    </Dialog>
  );
}
