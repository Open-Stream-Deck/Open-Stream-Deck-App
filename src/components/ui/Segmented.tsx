import type { ComponentChildren } from "preact";

type Option<T extends string> = { value: T; label: ComponentChildren; title?: string };

type Props<T extends string> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
};

export function Segmented<T extends string>({ value, options, onChange }: Props<T>) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div class="segmented" role="radiogroup" style={`--count: ${options.length}; --index: ${index}`}>
      <span class="segmented__thumb" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          data-tip={option.title}
          class={option.value === value ? "segmented__item segmented__item--active" : "segmented__item"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
