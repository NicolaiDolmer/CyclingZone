import { labelClass, helperClass } from "./fieldStyles.js";

export default function Field({ label, htmlFor, helper, error, children, className = "" }) {
  const message = error || helper;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className={labelClass()}>
          {label}
        </label>
      )}
      {children}
      {message && <p className={helperClass({ error: Boolean(error) })}>{message}</p>}
    </div>
  );
}
