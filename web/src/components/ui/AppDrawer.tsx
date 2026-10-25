import { Drawer, useOverlayState } from '@heroui/react';
import type { ReactNode } from 'react';

export interface AppDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode | ((close: () => void) => ReactNode);
  placement?: 'left' | 'right' | 'top' | 'bottom';
  className?: string;
}

/** antd Drawer 的等价物 */
export function AppDrawer({ open, onOpenChange, title, children, footer, placement = 'right', className }: AppDrawerProps) {
  const state = useOverlayState({ isOpen: open, onOpenChange });

  return (
    <Drawer state={state}>
      <Drawer.Backdrop>
        <Drawer.Content placement={placement} className={className}>
          <Drawer.Dialog>
            {({ close }) => (
              <>
                {title ? (
                  <Drawer.Header>
                    <Drawer.Heading>{title}</Drawer.Heading>
                  </Drawer.Header>
                ) : null}
                <Drawer.Body>{children}</Drawer.Body>
                {footer ? (
                  <Drawer.Footer>{typeof footer === 'function' ? footer(close) : footer}</Drawer.Footer>
                ) : null}
              </>
            )}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
