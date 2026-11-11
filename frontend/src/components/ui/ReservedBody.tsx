import { useEffect, useState, type ReactNode } from 'react';
import Skeleton from './Skeleton.jsx';

type Props = {
  name: string;
  loading: boolean;
  rows: number;
  rowHeight: number;
  children: ReactNode;
};

/** Reserve the bounded list's capacity in every state; long text may grow naturally. */
export default function ReservedBody({ name, loading, rows, rowHeight, children }: Props) {
  // Already-ready cards need no speculative whitespace. Once a placeholder was
  // visible, retain its footprint when content or an empty response arrives.
  const [reserved, setReserved] = useState(loading);
  useEffect(() => { if (loading) setReserved(true); }, [loading]);
  return (
    <div data-loading-region={name} aria-busy={loading} style={{ minHeight: loading || reserved ? rows * rowHeight : undefined }}>
      {loading ? (
        <div aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex flex-col justify-center gap-2" style={{ height: rowHeight }}>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : children}
    </div>
  );
}
