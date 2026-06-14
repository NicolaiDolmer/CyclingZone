export default function Toggle({ label, id, checked, className = "", ...rest }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-cz-1">
      <span className={`relative inline-block h-5 w-9 shrink-0 ${className}`}>
        <input id={id} type="checkbox" role="switch" checked={checked} className="peer sr-only" {...rest} />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-cz-pill bg-cz-subtle transition-colors duration-150 peer-checked:bg-cz-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cz-accent-t"
        />
        <span
          aria-hidden="true"
          className="absolute left-0.5 top-0.5 h-4 w-4 rounded-cz-pill bg-cz-card transition-transform duration-150 peer-checked:translate-x-4"
        />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
