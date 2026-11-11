import type { ComponentChildren } from "preact";
import { usePresence } from "../../hooks";

type Props = {
  open: boolean;
  align?: "start" | "end";
  class?: string;
  children: ComponentChildren;
};

export function Popover({ open, align = "start", class: className, children }: Props) {
  const mounted = usePresence(open, 160);
  if (!mounted) return null;

  const classes = ["popover", `popover--${align}`, open ? "popover--open" : "popover--closing", className]
    .filter(Boolean)
    .join(" ");

  return <div class={classes}>{children}</div>;
}
