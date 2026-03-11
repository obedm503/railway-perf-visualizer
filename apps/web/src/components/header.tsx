import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { Link, useNavigate } from "@tanstack/solid-router";
import { ErrorBoundary, type ParentProps, Show, Suspense } from "solid-js";
import { RailwayIcon } from "~/components/logo";
import { Skeleton } from "~/components/ui/skeleton";
import { logout, meQueryOptions } from "~/lib/api";

export function Header(props: ParentProps) {
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

          <Show when={props.children}>
            <span class="text-border">|</span>
            {props.children}
          </Show>
        </div>

        <div class="text-muted-foreground flex items-center gap-3 text-xs">
          <ErrorBoundary fallback={() => <HeaderAuthError />}>
            <Suspense fallback={<HeaderAuthSkeleton />}>
              <HeaderAuthActions />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </header>
  );
}

function HeaderAuthActions() {
  const meQuery = useQuery(() => meQueryOptions());
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    queryClient.clear();
    navigate({ to: "/login" });
  }

  return (
    <Show when={meQuery.data}>
      <button
        type="button"
        onClick={onLogout}
        class="border-border text-secondary-foreground hover:bg-accent hover:text-accent-foreground inline-flex cursor-pointer items-center rounded-lg border px-4 py-2 text-sm font-medium transition"
      >
        Logout
      </button>
    </Show>
  );
}

function HeaderAuthSkeleton() {
  return <Skeleton height={36} width={96} class="rounded-lg" />;
}

function HeaderAuthError() {
  return <span class="text-muted-foreground text-xs">Account unavailable</span>;
}
