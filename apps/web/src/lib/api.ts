import { hc } from "hono/client";
import type { AppType } from "api/app";

const apiOrigin: string =
  import.meta.env.VITE_API_ORIGIN?.toString() ?? "http://localhost:8787";

const apiClient = hc<AppType>(apiOrigin, {
  init: {
    credentials: "include",
  },
});

export const authLoginUrl = (callbackURL: string): string => {
  const search = new URLSearchParams({
    callbackURL,
  });

  return `${apiOrigin}/api/auth/login?${search.toString()}`;
};

export const fetchMe = async () => {
  const response = await apiClient.api.me.$get();
  if (!response.ok) {
    return null;
  }

  return await response.json();
};

export const logout = async (): Promise<void> => {
  await apiClient.api.auth.logout.$post();
};

export const meQueryOptions = () =>
  ({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 30_000,
    retry: false,
  }) as const;
