import { useTranslation } from "react-i18next";
import Skeleton from "./Skeleton.jsx";

/** Quiet shared transition while auth or a route is resolving. */
export default function AuthLoading({ fullPage = false }: { fullPage?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t("loading")}
      className={`bg-cz-body flex items-center justify-center ${fullPage ? "min-h-screen" : "min-h-[50vh]"}`}
    >
      <div className="w-48 space-y-3" data-auth-loading="static">
        <Skeleton staticMotion className="h-4 w-48" />
        <Skeleton staticMotion className="h-4 w-36" />
        <Skeleton staticMotion className="h-4 w-44" />
      </div>
    </div>
  );
}
