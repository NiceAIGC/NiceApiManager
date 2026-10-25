import { Modal, useOverlayState } from '@heroui/react';
import type { ReactNode } from 'react';

export interface AppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  /** 渲染 prop，可拿到 close 用于提交后关闭 */
  footer?: ReactNode | ((close: () => void) => ReactNode);
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'full' | 'cover';
  isDismissable?: boolean;
}

/** antd Modal 的等价物：受控 open + 标题 + 底部操作区 */
export function AppModal({ open, onOpenChange, title, children, footer, size = 'md', isDismissable = true }: AppModalProps) {
  const state = useOverlayState({ isOpen: open, onOpenChange });

  return (
    <Modal state={state}>
      <Modal.Backdrop isDismissable={isDismissable}>
        <Modal.Container size={size}>
          <Modal.Dialog>
            {({ close }) => (
              <>
                <Modal.Header>
                  <Modal.Heading>{title}</Modal.Heading>
                </Modal.Header>
                <Modal.Body>{children}</Modal.Body>
                {footer ? (
                  <Modal.Footer>{typeof footer === 'function' ? footer(close) : footer}</Modal.Footer>
                ) : null}
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
