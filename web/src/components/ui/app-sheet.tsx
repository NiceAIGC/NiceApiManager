import type { ReactNode } from 'react';

import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './sheet';

interface AppSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'left' | 'right';
  className?: string;
}

export function AppSheet({ open, onOpenChange, title, description, children, footer, side = 'right', className }: AppSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={className}>
        {title ? (
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
        ) : null}
        <SheetBody>{children}</SheetBody>
        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
