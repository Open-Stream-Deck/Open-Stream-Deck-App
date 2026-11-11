type Props = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  label?: string;
};

export function Slider({ value, min, max, step = 1, onChange, format, label }: Props) {
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div class="slider">
      <input
        class="slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={`--fill: ${percent}%`}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
      />
      {format && <span class="slider__value">{format(value)}</span>}
    </div>
  );
}
