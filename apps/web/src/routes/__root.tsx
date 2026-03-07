import { QueryClient } from "@tanstack/solid-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/solid-router";

export interface RouterContext {
  queryClient: QueryClient;
}

function RootComponent() {
  return <Outlet />;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  onError(err) {
    console.error(err);
  },
  errorComponent(props) {
    console.error(props.error, props.info);
    return null;
  },
});
