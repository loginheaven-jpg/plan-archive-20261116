import * as Radix from "@radix-ui/react-dialog";
import { X } from "lucide-react";
export default function Dialog({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Radix.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Radix.Portal>
        <Radix.Overlay className="dialog-overlay" />
        <Radix.Content
          className={`dialog ${wide ? "wide" : ""}`}
          aria-describedby={description ? "dialog-description" : undefined}
        >
          <header className="dialog-heading">
            <div>
              <Radix.Title>{title}</Radix.Title>
              {description && (
                <Radix.Description id="dialog-description">
                  {description}
                </Radix.Description>
              )}
            </div>
            <button className="icon-button" aria-label="닫기" onClick={onClose}>
              <X size={22} />
            </button>
          </header>
          {children}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
