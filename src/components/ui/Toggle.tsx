type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
};

export function Toggle({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      class={checked ? "toggle toggle--on" : "toggle"}
      onClick={() => onChange(!checked)}
    >
      <span class="toggle__knob" />
    </button>
  );
}
