import { toast } from 'sonner';

/** 全局轻提示，统一入口 */
export const notify = {
  success: (message: React.ReactNode) => toast.success(message),
  error: (message: React.ReactNode) => toast.error(message),
  warning: (message: React.ReactNode) => toast.warning(message),
  info: (message: React.ReactNode) => toast.info(message),
};
