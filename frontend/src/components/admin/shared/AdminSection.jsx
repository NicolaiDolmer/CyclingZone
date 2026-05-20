export default function AdminSection({ title, children }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-4 sm:p-5 mb-4">
      <h2 className="text-cz-1 font-semibold text-sm mb-4 flex items-center gap-2">
        <span className="w-1 h-4 bg-red-400 rounded-full" />{title}
      </h2>
      {children}
    </div>
  );
}
