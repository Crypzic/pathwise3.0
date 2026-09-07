import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

export function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible">
      <div className="collapsible-header" onClick={() => setOpen((o) => !o)}>
        {title}
        <ChevronDownIcon cls={`icon-sm collapsible-chevron ${open ? "open" : ""}`} />
      </div>
      <div className={`collapsible-body ${open ? "open" : ""}`}>
        <div>{children}</div>
      </div>
    </div>
  );
}
