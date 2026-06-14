import { categoryTagClass } from "./badgeStyles.js";

export default function CategoryTag({ dense = false, children, className = "" }) {
  return <span className={`${categoryTagClass({ dense })} ${className}`}>{children}</span>;
}
