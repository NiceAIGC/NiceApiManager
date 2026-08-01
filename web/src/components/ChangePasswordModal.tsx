import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, addToast } from '@heroui/react';
import { useState } from 'react';
import type { ChangePasswordPayload } from '../types/api';

export function ChangePasswordModal({ open, loading, onCancel, onSubmit }: { open: boolean; loading: boolean; onCancel: () => void; onSubmit: (values: ChangePasswordPayload) => void }) {
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
  const submit = () => { if (!currentPassword || !newPassword) { addToast({ title: '请填写所有密码字段', color: 'warning' }); return; } if (newPassword.length < 6) { addToast({ title: '新密码至少 6 位', color: 'warning' }); return; } if (newPassword !== confirmation) { addToast({ title: '两次输入的新密码不一致', color: 'warning' }); return; } onSubmit({ current_password: currentPassword, new_password: newPassword }); };
  return <Modal isOpen={open} onOpenChange={(next) => { if (!next) onCancel(); }}><ModalContent>{() => <><ModalHeader>修改登录密码</ModalHeader><ModalBody><Input label="当前密码" type="password" value={currentPassword} onValueChange={setCurrentPassword} /><Input label="新密码" type="password" value={newPassword} onValueChange={setNewPassword} /><Input label="确认新密码" type="password" value={confirmation} onValueChange={setConfirmation} /></ModalBody><ModalFooter><Button variant="light" onPress={onCancel}>取消</Button><Button color="primary" isLoading={loading} onPress={submit}>保存密码</Button></ModalFooter></>}</ModalContent></Modal>;
}
