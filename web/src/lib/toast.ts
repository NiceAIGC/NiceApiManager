import { toast } from '@heroui/react';

/**
 * 全局轻提示，替代 antd 的 message.xxx。
 * 需要 <Toast.Provider /> 已挂载（见 main.tsx）。
 */
export const notify = {
  success: (message: React.ReactNode) => toast.success(message),
  error: (message: React.ReactNode) => toast.danger(message),
  warning: (message: React.ReactNode) => toast.warning(message),
  info: (message: React.ReactNode) => toast.info(message),
};
