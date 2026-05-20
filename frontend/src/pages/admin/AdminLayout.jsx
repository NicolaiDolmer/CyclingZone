import { Outlet } from "react-router-dom";
import { Suspense } from "react";
import AdminTabs from "../../components/admin/shared/AdminTabs";

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function AdminLayout() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-cz-1">Admin Panel</h1>
        <p className="text-cz-3 text-sm">Sæsonstyring, økonomi og system</p>
      </div>
      <AdminTabs />
      <Suspense fallback={<TabFallback />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
