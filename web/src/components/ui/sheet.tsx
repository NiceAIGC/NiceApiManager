import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: 'left' | 'right'; showCloseButton?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 z-50 flex h-full w-3/4 max-w-sm flex-col gap-0 border bg-card shadow-lg sm:max-w-sm',
          side === 'left' ? 'left-0 border-r data-[state=open]:slide-in-from-left' : 'right-0 border-l data-[state=open]:slide-in-from-right',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-sm opacity-70 transition-opacity hover:opacity-100">
            <X className="size-4" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 border-b p-4 pr-10', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-base font-semibold', className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto p-4', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center justify-end gap-2 border-t p-4', className)} {...props} />;
}
