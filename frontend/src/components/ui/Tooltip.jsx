import { tooltipClass } from "./tooltipStyles.js";

export default function Tooltip({ label, side = "top", open = false, id, className = "", children }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" id={id} className={`${tooltipClass({ side })} ${open ? "!opacity-100" : ""} ${className}`}>
        {label}
      </span>
    </span>
  );
}
