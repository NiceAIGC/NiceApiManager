import { useEffect } from 'react';

/**
 * Radix Dialog/Sheet 会给 body 加 `pointer-events: none` 做滚动锁；
 * 多个弹窗叠加或弹窗开着就跳转时，清理顺序可能错乱，导致 body 残留 none，
 * 整个页面点不动。这里做兜底：只要页面上已没有任何打开的对话框，就清掉锁。
 */
export function useBodyScrollLockFix() {
  useEffect(() => {
    const clearIfUnlocked = () => {
      if (document.body.style.pointerEvents === 'none' && !document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        document.body.style.pointerEvents = '';
        document.body.style.overflow = '';
      }
    };
    const observer = new MutationObserver(() => clearIfUnlocked());
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}
