import { useEffect, useRef } from "react";
import { ORGANIZATIONS } from "@/domain/organizations";
import type { OrganizationId } from "@/domain/types";
export default function DepartmentFilter({
  selected,
  onChange,
  includeAll,
  onIncludeAll,
}: {
  selected: OrganizationId[];
  onChange: (ids: OrganizationId[]) => void;
  includeAll: boolean;
  onIncludeAll: (value: boolean) => void;
}) {
  const allRef = useRef<HTMLInputElement>(null);
  const all = selected.length === ORGANIZATIONS.length;
  useEffect(() => {
    if (allRef.current)
      allRef.current.indeterminate = selected.length > 0 && !all;
  }, [selected, all]);
  return (
    <div className="department-filter">
      <label className="checkbox-row all-select">
        <input
          ref={allRef}
          type="checkbox"
          checked={all}
          aria-checked={selected.length > 0 && !all ? "mixed" : all}
          onChange={() => onChange(all ? [] : ORGANIZATIONS.map((o) => o.id))}
        />
        <span>전체 선택</span>
      </label>
      <div className="department-options">
        {ORGANIZATIONS.map((o) => (
          <label key={o.id} className="checkbox-row department-option">
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={() =>
                onChange(
                  selected.includes(o.id)
                    ? selected.filter((id) => id !== o.id)
                    : [...selected, o.id],
                )
              }
            />
            <i className="color-dot" style={{ background: o.color }} />
            <span>{o.name}</span>
          </label>
        ))}
      </div>
      <label className="checkbox-row audience-toggle">
        <input
          type="checkbox"
          checked={includeAll}
          onChange={(e) => onIncludeAll(e.target.checked)}
        />
        <span>전교회 대상도 함께</span>
      </label>
      <p className="filter-note">
        주관부서와 참여 대상은 달라요.
        <br />
        필요한 부서를 함께 선택하세요.
      </p>
    </div>
  );
}
