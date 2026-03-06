import { hc } from "hono/client";
import type { AppType } from "api/app";

const apiOrigin: string =
  import.meta.env.VITE_API_ORIGIN?.toString() ?? "http://localhost:8787";

const apiClient = hc<AppType>(apiOrigin, {
  init: {
    credentials: "include",
  },
});

export function authLoginUrl(callbackURL: string): string {
  const search = new URLSearchParams({
    callbackURL,
  });

  return `${apiOrigin}/api/auth/login?${search.toString()}`;
}

export async function fetchMe() {
  const response = await apiClient.api.me.$get();
  if (!response.ok) {
    return null;
  }

  return await response.json();
}

export async function logout(): Promise<void> {
  await apiClient.api.auth.logout.$post();
}

export function meQueryOptions() {
  return {
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 30_000,
    retry: false,
  } as const;
}
