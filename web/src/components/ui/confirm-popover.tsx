import { useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

interface ConfirmPopoverProps {
  title: ReactNode;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => unknown | Promise<unknown>;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}

/** 就地气泡确认，替代原生 confirm */
export function ConfirmPopover({ title, description, confirmText = '确认', cancelText = '取消', onConfirm, children, align = 'end' }: ConfirmPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handleConfirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-72">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">{title}</div>
            {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {cancelText}
            </Button>
            <Button size="sm" variant="destructive" isPending={pending} onClick={handleConfirm}>
              {confirmText}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
