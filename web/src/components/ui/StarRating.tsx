import { Star } from 'lucide-react';

import { cx } from '../../lib/cx';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  count?: number;
  size?: number;
  className?: string;
}

/** 优先级星级，替代 antd Rate；不传 onChange 为只读 */
export function StarRating({ value, onChange, count = 5, size = 15, className }: StarRatingProps) {
  const readOnly = !onChange;

  return (
    <div className={cx('inline-flex items-center gap-0.5', className)} role={readOnly ? 'img' : 'radiogroup'} aria-label={`优先级 ${value} 星`}>
      {Array.from({ length: count }, (_, index) => index + 1).map((star) => {
        const filled = star <= value;
        const icon = (
          <Star
            size={size}
            strokeWidth={1.5}
            className={filled ? 'fill-warning text-warning' : 'fill-transparent text-border'}
          />
        );
        if (readOnly) return <span key={star}>{icon}</span>;
        return (
          <button
            key={star}
            type="button"
            aria-label={`${star} 星`}
            className="cursor-pointer rounded-sm p-0 leading-none transition-transform hover:scale-110"
            onClick={() => onChange(star === value ? 0 : star)}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}
