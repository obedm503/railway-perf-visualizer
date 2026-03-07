import type { ParentProps } from "solid-js";
import { cn } from "~/lib/utils";

export function Content(props: ParentProps & { class?: string }) {
  return (
    <div class={cn("min-h-[calc(100vh-3.5rem)]", props.class)}>
      {props.children}
    </div>
  );
}
