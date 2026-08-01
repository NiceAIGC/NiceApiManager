import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  isLoading?: boolean;
  isDanger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ isOpen, title, children, confirmLabel = '确认', isLoading, isDanger, onClose, onConfirm }: ConfirmDialogProps) {
  return <Modal isOpen={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}><ModalContent>{() => <><ModalHeader>{title}</ModalHeader><ModalBody>{children}</ModalBody><ModalFooter><Button variant="light" onPress={onClose}>取消</Button><Button color={isDanger ? 'danger' : 'primary'} isLoading={isLoading} onPress={onConfirm}>{confirmLabel}</Button></ModalFooter></>}</ModalContent></Modal>;
}
