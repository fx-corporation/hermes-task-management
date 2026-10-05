import type { ReactNode } from "react";

export function Message({
  metadata,
  children,
}: {
  metadata: string;
  children: ReactNode;
}) {
  return (
    <div className="message">
      <div className="meta">{metadata}</div>
      {children}
    </div>
  );
}
