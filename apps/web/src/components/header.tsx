import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import type { ParentProps } from "solid-js";
import { RailwayIcon } from "~/components/logo";
import { logout, meQueryOptions } from "~/lib/api";

export function Header(props: ParentProps) {
  const meQuery = useQuery(() => meQueryOptions());
  const queryClient = useQueryClient();

  async function onLogout() {
    queryClient.clear();
    await logout();
  }

  return (
    <header class="border-border bg-background sticky top-0 z-40 border-b">
      <div class="flex h-14 items-center justify-between px-4">
        <div class="flex items-center gap-2 text-sm">
          <Link
            to="/"
            class="inline-flex h-7 w-7 items-center justify-center rounded-full pr-2"
          >
            <RailwayIcon />
          </Link>

          {props.children ? (
            <>
              <span class="text-border">|</span>
              {props.children}
            </>
          ) : null}
        </div>

        <div class="text-muted-foreground flex items-center gap-3 text-xs">
          {meQuery.data ? (
            <button
              type="button"
              onClick={onLogout}
              class="border-border text-secondary-foreground hover:bg-accent hover:text-accent-foreground inline-flex cursor-pointer items-center rounded-lg border px-4 py-2 text-sm font-medium transition"
            >
              Logout
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
