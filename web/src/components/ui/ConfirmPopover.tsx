import { Button, Popover } from '@heroui/react';
import { useState } from 'react';
import type { ReactNode } from 'react';

interface ConfirmPopoverProps {
  title: ReactNode;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => unknown | Promise<unknown>;
  /** 触发元素，需可挂 ref 接收点击（如 Button） */
  children: ReactNode;
  loading?: boolean;
}

/** antd Popconfirm 的等价物：就地气泡确认 */
export function ConfirmPopover({ title, description, confirmText = '确认', cancelText = '取消', onConfirm, children, loading }: ConfirmPopoverProps) {
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
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger>{children}</Popover.Trigger>
      <Popover.Content>
        <Popover.Dialog className="max-w-72">
          <div className="flex flex-col gap-3 p-1">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">{title}</div>
              {description ? <div className="text-xs text-muted">{description}</div> : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>
                {cancelText}
              </Button>
              <Button size="sm" variant="danger" isPending={pending || loading} onPress={handleConfirm}>
                {confirmText}
              </Button>
            </div>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
