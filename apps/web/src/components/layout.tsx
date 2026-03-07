import type { ParentProps } from "solid-js";

export function Layout(props: ParentProps) {
  return <main class="text-foreground min-h-screen">{props.children}</main>;
}
