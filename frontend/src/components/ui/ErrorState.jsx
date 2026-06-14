import { AlertTriangleIcon } from "./icons/index.jsx";

export default function ErrorState({
  title = "Something went wrong",
  description,
  action = null,
  className = "",
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-cz border border-cz-danger/40 bg-cz-danger/5 px-6 py-12 text-center ${className}`}
    >
      <AlertTriangleIcon size={24} className="mb-3 text-cz-danger" />
      <p className="text-sm font-semibold text-cz-1">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-cz-2">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
