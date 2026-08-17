import type { ButtonHTMLAttributes } from 'react';

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What is being switched — the accessible name, e.g. the mod's own name. */
  label: string;
}

/**
 * An on/off control that says which it is without being read.
 *
 * It exists because the alternative does not survive translation. A button
 * labelled with its action — "Disable" for something that is currently on — is
 * one suffix away from the adjective describing the state in Polish ("Wyłącz"
 * against "Wyłączone"), and a list of forty mods each ending in a small grey
 * "Wyłącz" was read by the first person to install a pack as forty disabled
 * mods. Position and colour carry no such ambiguity in any language.
 *
 * `role="switch"` with `aria-checked` is the same statement made to a screen
 * reader, which announces the label and then on or off.
 */
export function Switch({ checked, onChange, label, className = '', ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-1 focus:ring-rf-accent focus:ring-offset-1 focus:ring-offset-rf-bg disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-rf-accent' : 'bg-rf-border'
      } ${className}`}
      {...props}
    >
      {/* Colour as well as position: the two states have to differ for someone
          who cannot pick a 16px offset out of a list of identical rows. */}
      <span
        className={`h-3.5 w-3.5 rounded-full transition-transform ${
          checked ? 'translate-x-[19px] bg-white' : 'translate-x-[3px] bg-rf-text-muted'
        }`}
      />
    </button>
  );
}
