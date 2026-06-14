import { cellClass } from "./tableStyles.js";

export function Table({ className = "", children, ...rest }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse ${className}`} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Tr({ className = "", children, ...rest }) {
  return (
    <tr className={`group transition-colors duration-150 hover:bg-cz-subtle ${className}`} {...rest}>
      {children}
    </tr>
  );
}

export function Th({ numeric = false, sticky = false, className = "", children, ...rest }) {
  const stickyCls = sticky ? "sticky left-0 z-sticky" : "";
  return (
    <th className={`${cellClass({ numeric, header: true })} bg-cz-subtle ${stickyCls} ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function Td({ numeric = false, sticky = false, className = "", children, ...rest }) {
  const stickyCls = sticky ? "sticky left-0 z-sticky bg-cz-card group-hover:bg-cz-subtle" : "";
  return (
    <td className={`${cellClass({ numeric })} ${stickyCls} ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function JerseyDot({ color = "#888", title, className = "" }) {
  return (
    <span
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      title={title}
      className={`inline-block h-2.5 w-2.5 rounded-cz-pill ring-1 ring-cz-border ${className}`}
      style={{ backgroundColor: color }}
    />
  );
}
