export default function Radio({ label, id, className = "", ...rest }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-cz-1">
      <input
        id={id}
        type="radio"
        className={`h-4 w-4 rounded-cz-pill accent-cz-accent ${className}`}
        {...rest}
      />
      {label && <span>{label}</span>}
    </label>
  );
}
