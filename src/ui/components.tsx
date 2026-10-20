import type { ReactNode } from "react";

export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="tool-row toggle-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function Action({
  label,
  detail,
  onClick,
  icon,
  disabled = false,
}: {
  label: string;
  detail?: string;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="tool-row action-row"
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span className="row-icon">{icon}</span>}
      <span className="grow">{label}</span>
      {detail && <small>{detail}</small>}
      <span className="arrow" aria-hidden="true">
        ↗
      </span>
    </button>
  );
}
export function Section({
  title,
  children,
  detail,
}: {
  title: string;
  children: ReactNode;
  detail?: string;
}) {
  return (
    <section className="tool-section">
      <div className="section-heading">
        <h2>{title}</h2>
        {detail && <small>{detail}</small>}
      </div>
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function downloadText(
  text: string,
  filename: string,
  type = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
