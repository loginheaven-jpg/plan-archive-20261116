import { parsePastedTable } from "@/domain/annual";

/** Forced delimiter parsing keeps quoted cells as literal text, never formulas. */
export function readPaste(text: string, delimiter: string): string[][] {
  if (delimiter === "auto") return parsePastedTable(text);
  if (
    text.length > 1_000_000 ||
    new TextEncoder().encode(text).length > 1_000_000
  ) {
    throw new Error("붙여넣기는 1MB 이내로 나누어 입력하세요.");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new Error("허용되지 않는 제어문자가 있습니다.");
  }
  if (!text.trim()) return [];
  const separator = delimiter === "tab" ? "\t" : ",";
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let mode: "plain" | "quoted" | "closed" = "plain";
  const pushCell = () => {
    row.push(cell);
    cell = "";
    if (row.length > 50) throw new Error("붙여넣기는 50열 이내로 입력하세요.");
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > 1000)
      throw new Error("붙여넣기는 1,000행 이내로 나누어 입력하세요.");
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (mode === "quoted") {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else mode = "closed";
      } else if (char === "\r") {
        if (source[i + 1] === "\n") i++;
        cell += "\n";
      } else cell += char;
    } else if (char === separator) {
      pushCell();
      mode = "plain";
    } else if (char === "\r" || char === "\n") {
      pushRow();
      mode = "plain";
      if (char === "\r" && source[i + 1] === "\n") i++;
    } else if (char === '"') {
      if (mode !== "plain" || cell)
        throw new Error(
          "따옴표는 칸 시작에 쓰고 내부 따옴표는 두 번 입력하세요.",
        );
      mode = "quoted";
    } else {
      if (mode === "closed")
        throw new Error(
          "닫는 따옴표 뒤에는 선택한 구분자 또는 줄바꿈이 필요합니다.",
        );
      cell += char;
    }
    if (cell.length > 20_000)
      throw new Error("한 칸은 20,000자 이내로 입력하세요.");
  }
  if (mode === "quoted") throw new Error("닫히지 않은 따옴표가 있습니다.");
  if (cell || row.length || mode === "closed" || !/[\r\n]$/.test(source))
    pushRow();
  return rows;
}
