import { EyeOff } from 'lucide-react';
import { useFocusOnMount } from '../hooks';
import { useStrings } from '../i18n';

/**
 * Forward-compatibility fallback for step types this client does not know: a striped card with a
 * neutral icon, "Step unavailable" and a short note (the raw step type is internal and never
 * shown). Continue (footer) moves on; navigation treats it as a non-interactive step.
 */
export function UnknownStep() {
  const t = useStrings();
  const titleRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="flex flex-1 flex-col px-[18px] pt-[34px] md:px-[26px]">
      <div className="flex flex-col items-start gap-4 rounded-[26px] border border-ink/[0.06] bg-paper bg-stripes p-[26px]">
        <span
          aria-hidden
          className="grid size-10 place-items-center rounded-xl border-[1.5px] border-dashed border-ink/25 text-ink-2"
        >
          <EyeOff className="size-[18px]" strokeWidth={2} />
        </span>
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="font-display text-[26px] leading-[1.05] font-bold tracking-[-0.03em] text-ink outline-none"
        >
          {t.unavailableTitle}
        </h1>
        <p className="text-[15px] leading-normal text-ink-2">{t.unavailableText}</p>
      </div>
    </div>
  );
}
