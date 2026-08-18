import { useId } from 'react';
import { MAX_RAM_MB, MIN_RAM_MB, RAM_STEP_MB } from '@shared/constants';
import { formatRamGb, ramAdvice, recommendedRamMb } from '@shared/memory';
import { useT } from '@renderer/i18n';

interface RamFieldProps {
  valueMb: number;
  onChange: (mb: number) => void;
  /** The machine's physical memory, or undefined while unknown or unreadable. */
  totalMb?: number;
}

/**
 * How much memory this profile hands the game, against how much the machine
 * has.
 *
 * A bare number box is what this was, and a number box cannot say the one thing
 * that matters: 16 GB is a fine setting on one machine and a game that will not
 * start on the next. The slider is bounded by the machine, so the mistake is
 * hard to make by dragging; the number box stays because a pack's instructions
 * are written in megabytes and typing 6144 should not require counting notches.
 *
 * Nothing here refuses a value. The bounds are the schema's, the warning is
 * advice, and someone who knows their swap file better than the launcher does
 * can overrule it — right up until the allocation exceeds physical memory,
 * which the launch path refuses outright because there is no machine on which
 * it works.
 *
 * With `totalMb` undefined — the reply has not arrived, or the main process
 * could not read it — this is exactly the control it replaced: the full 512 MB
 * to 32 GB range and no commentary. Guessing at a machine we could not measure
 * would put a number in front of someone that has nothing behind it.
 */
export function RamField({ valueMb, onChange, totalMb }: RamFieldProps) {
  const t = useT();
  const id = useId();
  const advice = ramAdvice(valueMb, totalMb);
  const recommended = recommendedRamMb(totalMb);

  // The right-hand end of the slider. The machine's own memory once it is
  // known — a laptop's control has no business running to 32 GB — but never
  // below what the profile already holds, or an allocation inherited from a
  // larger machine would show as a slider pinned at the top with no sign of
  // how far past the end it really is.
  const machineMax =
    totalMb === undefined ? MAX_RAM_MB : Math.floor(totalMb / RAM_STEP_MB) * RAM_STEP_MB;
  const sliderMax = Math.min(MAX_RAM_MB, Math.max(machineMax, valueMb, MIN_RAM_MB + RAM_STEP_MB));
  const sliderValue = Math.min(Math.max(valueMb || MIN_RAM_MB, MIN_RAM_MB), sliderMax);

  const message =
    advice === 'over'
      ? t('profileForm.ramOver', { value: formatRamGb(valueMb), total: formatRamGb(totalMb ?? 0) })
      : advice === 'tight'
        ? t('profileForm.ramTight', {
            value: formatRamGb(valueMb),
            total: formatRamGb(totalMb ?? 0),
          })
        : totalMb === undefined
          ? ''
          : t('profileForm.ramMachine', {
              total: formatRamGb(totalMb),
              recommended: formatRamGb(recommended),
            });

  const tone =
    advice === 'over'
      ? 'text-rf-danger'
      : advice === 'tight'
        ? 'text-rf-warning'
        : 'text-rf-text-muted';

  return (
    <div className="col-span-2 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-rf-text-secondary">
          {t('profileForm.ram')}
        </label>
        <div className="flex items-baseline gap-1.5">
          <input
            type="number"
            aria-label={t('profileForm.ram')}
            value={valueMb}
            onChange={(e) => onChange(Number(e.target.value))}
            min={MIN_RAM_MB}
            max={MAX_RAM_MB}
            step={RAM_STEP_MB}
            className="w-24 rounded-lg border border-rf-border bg-rf-surface px-2 py-1 text-right text-sm text-rf-text outline-none focus:border-rf-accent-text focus:ring-1 focus:ring-rf-accent-text transition-colors"
          />
          <span className="text-xs text-rf-text-muted">MB</span>
        </div>
      </div>

      <input
        id={id}
        type="range"
        value={sliderValue}
        onChange={(e) => onChange(Number(e.target.value))}
        min={MIN_RAM_MB}
        max={sliderMax}
        step={RAM_STEP_MB}
        aria-valuetext={formatRamGb(valueMb)}
        aria-describedby={message ? `${id}-note` : undefined}
        className="w-full accent-rf-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rf-accent-text"
      />

      <div className="flex items-baseline justify-between gap-3">
        <span
          id={`${id}-note`}
          className={`text-xs ${tone}`}
          role={advice === 'ok' ? undefined : 'alert'}
        >
          {message}
        </span>
        {totalMb !== undefined && valueMb !== recommended && (
          <button
            type="button"
            onClick={() => onChange(recommended)}
            className="shrink-0 text-xs text-rf-accent-text underline-offset-2 hover:underline"
          >
            {t('profileForm.ramUseRecommended', { recommended: formatRamGb(recommended) })}
          </button>
        )}
      </div>
    </div>
  );
}
