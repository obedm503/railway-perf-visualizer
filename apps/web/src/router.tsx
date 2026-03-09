import { QueryClient } from "@tanstack/solid-query";
import { createRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";

const queryClient = new QueryClient({
  defaultOptions: { queries: { throwOnError: true } },
});

export const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
});

export { queryClient };

declare module "@tanstack/solid-router" {
  interface Register {
    router: typeof router;
  }
}
