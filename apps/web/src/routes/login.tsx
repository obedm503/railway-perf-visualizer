import { createFileRoute, Link } from "@tanstack/solid-router";
import { Header } from "~/components/header";
import { Layout } from "~/components/layout";
import { RailwayIcon } from "~/components/logo";
import { authLoginUrl } from "~/lib/api";

type LoginSearch = {
  redirect?: string;
};

export const Route = createFileRoute("/login")({
  validateSearch(search: Record<string, unknown>): LoginSearch {
    return {
      redirect:
        typeof search.redirect === "string" ? search.redirect : undefined,
    };
  },
  component: Login,
});

function Login() {
  const search = Route.useSearch();
  const redirectPath = () => search().redirect;

  const loginUrl = () => {
    const path = redirectPath();
    const callbackURL = path
      ? `${window.location.origin}${path}`
      : `${window.location.origin}/`;
    return authLoginUrl(callbackURL);
  };

  return (
    <Layout>
      <Header />
      <div class="p-4 md:p-6">
        <section class="border-border bg-secondary-background mx-auto w-full max-w-xl rounded-2xl border p-8 sm:p-10">
          <h1 class="text-foreground mt-3 text-3xl font-semibold tracking-tight">
            Railway Performance Visualizer
          </h1>

          <div class="mt-6 space-y-4">
            <Link
              to={loginUrl()}
              class="border-active-border bg-primary text-primary-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              aria-label="Sign in with Railway"
            >
              <span class="inline-flex h-6 w-6 items-center justify-center rounded-full">
                <RailwayIcon />
              </span>
              Sign in with Railway
            </Link>
          </div>
        </section>
      </div>
    </Layout>
  );
}
