/* @refresh reload */
import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { render } from "solid-js/web";
import { queryClient, router } from "./router";
import "./index.css";

const root = document.getElementById("root");

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  ),
  root!,
);
