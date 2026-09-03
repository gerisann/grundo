import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  /** `null`: nincs kiválasztott elem — a csoport egyik gombja sem aktív. */
  value: T | null;
  onChange: (value: T) => void;
  /** Kötelező: a csoport neve képernyőolvasónak. */
  label: string;
  size?: 'sm' | 'md';
  /** A teljes szélességet kitölti, egyenlő szélességű elemekkel. */
  block?: boolean;
  /**
   * Hány oszlopba rendezze `block` módban.
   * Alapértelmezés: háromig egy sor, fölötte 2×2 rács — mert négy elem
   * egy sorban mobilon 3+1-re törik, ami töröttnek látszik.
   */
  columns?: number;
}

/**
 * Az app leggyakoribb vezérlője: FUTÁS/SÉTA/BRINGA, 50/100/200 m,
 * Globális/Lokális, gyalogos ⇄ kerékpáros réteg-váltó, témamódok.
 *
 * Rádiócsoportként viselkedik: nyilakkal léptethető, és mindig pontosan
 * egy elem aktív.
 *
 * A LAB lejátszás két helyen ugyanazt a numerikus preset + `max` mintát
 * használja. Ennél a mintánál automatikusan megjelenik egy kézi szorzómező,
 * így a fix presetek mellett tetszőleges pozitív sebesség (pl. 0.5×, 2.5×,
 * 37×) is megadható anélkül, hogy a két LAB képernyő külön vezérlőt tartana.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  block = false,
  columns,
}: SegmentedControlProps<T>) {
  const cols = columns ?? (options.length <= 3 ? options.length : 2);
  const customRateEnabled = supportsCustomPlaybackRate(options);
  const hasPresetSelection = options.some((option) => option.value === value);
  const currentNumericValue = value !== null && value !== 'max' ? value : '';
  const [customDraft, setCustomDraft] = useState(currentNumericValue);
  const customEditing = useRef(false);

  useEffect(() => {
    if (!customRateEnabled || customEditing.current) return;
    setCustomDraft(currentNumericValue);
  }, [customRateEnabled, currentNumericValue]);

  function move(delta: number) {
    const index = options.findIndex((o) => o.value === value);
    if (index < 0) return;
    const next = options[(index + delta + options.length) % options.length];
    if (next) onChange(next.value);
  }

  function commitCustomRate() {
    const normalized = customDraft.trim().replace(',', '.');
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setCustomDraft(currentNumericValue);
      return;
    }

    const canonical = String(numeric);
    setCustomDraft(canonical);
    onChange(canonical as T);
  }

  return (
    <>
      <div
        role="radiogroup"
        aria-label={label}
        className={['seg', size === 'sm' ? 'seg--sm' : '', block ? 'seg--block' : '']
          .filter(Boolean)
          .join(' ')}
        style={block ? ({ '--seg-cols': cols } as CSSProperties) : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        {options.map((option, index) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked || (!hasPresetSelection && index === 0) ? 0 : -1}
              className="seg__item"
              data-value={option.value}
              onClick={() => onChange(option.value)}
            >
              {option.icon}
              {option.label}
            </button>
          );
        })}
      </div>

      {customRateEnabled ? (
        <label className="field">
          <span className="field__label">Egyéni lejátszási sebesség</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              className="field__input"
              type="text"
              inputMode="decimal"
              value={customDraft}
              placeholder={value === 'max' ? 'MAX' : 'pl. 2.5'}
              aria-label={`${label} egyéni szorzó`}
              onFocus={() => {
                customEditing.current = true;
              }}
              onChange={(event) => setCustomDraft(event.target.value)}
              onBlur={() => {
                customEditing.current = false;
                commitCustomRate();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setCustomDraft(currentNumericValue);
                  event.currentTarget.blur();
                }
              }}
            />
            <strong aria-hidden="true">×</strong>
          </div>
        </label>
      ) : null}
    </>
  );
}

function supportsCustomPlaybackRate<T extends string>(options: readonly SegmentOption<T>[]): boolean {
  if (!options.some((option) => option.value === 'max')) return false;
  const numericValues = options.filter((option) => option.value !== 'max');
  return numericValues.length > 0 && numericValues.every((option) => {
    const numeric = Number(option.value);
    return Number.isFinite(numeric) && numeric > 0;
  });
}
