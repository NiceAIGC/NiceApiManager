import { Star } from 'lucide-react';

import { cn } from '@/lib/utils';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  count?: number;
  size?: number;
  className?: string;
}

export function StarRating({ value, onChange, count = 5, size = 14, className }: StarRatingProps) {
  const readOnly = !onChange;
  return (
    <div className={cn('inline-flex items-center gap-0.5', className)} role={readOnly ? 'img' : 'radiogroup'} aria-label={`优先级 ${value} 星`}>
      {Array.from({ length: count }, (_, index) => index + 1).map((star) => {
        const filled = star <= value;
        const icon = (
          <Star
            size={size}
            strokeWidth={1.5}
            className={filled ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-muted-foreground/40'}
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
