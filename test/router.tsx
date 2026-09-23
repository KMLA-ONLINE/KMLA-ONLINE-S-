import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRoutesStub,
  Outlet,
  type RoutesTestStubProps,
} from "react-router";
import type { ComponentType, ReactNode } from "react";

import { ImageViewerProvider } from "~/shared/hooks/use-image-viewer-param";

type StubRoutes = Parameters<typeof createRoutesStub>[0];

function ImageViewerLayout() {
  return (
    <ImageViewerProvider>
      <Outlet />
    </ImageViewerProvider>
  );
}

type RenderRouteOptions = RoutesTestStubProps &
  Omit<RenderOptions, "wrapper"> & {
    /** Extra routes to register alongside the one under test. */
    routes?: StubRoutes;
    /** Path pattern the component is mounted at. Defaults to `/`. */
    path?: string;
    /**
     * Action for the route under test. Pass it when the component submits a form
     * or fetcher, so the submission resolves instead of rendering the router
     * error boundary.
     */
    action?: StubRoutes[number]["action"];
    /** Loader for the route under test. Pass a `clientLoader` through here. */
    loader?: StubRoutes[number]["loader"];
  };

/**
 * Renders a single route component inside a real router context.
 *
 * `createRoutesStub` only understands the server-side `loader`/`action` keys, so
 * when testing a route that ships a `clientLoader`, pass it through as `loader`
 * — the stub resolves it before rendering either way.
 *
 * A `QueryClientProvider` comes along because app chrome reads from the query
 * cache — `useNavBadges()` in the sidebar and tab bar is a `useQuery`. Without
 * it, rendering anything that pulls in the shell fails with "No QueryClient
 * set" instead of the assertion under test. Each render gets a fresh client so
 * one test cannot see another's cached data; `retry: false` keeps a failing
 * query from stalling the test for the default backoff.
 */
export function renderRoute(
  Component: ComponentType<any>,
  {
    routes = [],
    path = "/",
    action,
    loader,
    initialEntries,
    initialIndex,
    hydrationData,
    future,
    ...renderOptions
  }: RenderRouteOptions = {},
) {
  const Stub = createRoutesStub([
    {
      // `app/root.tsx`와 같은 자리다. provider가 라우트 위에 있어야 화면을 옮겨도 살아남고,
      // 등록을 거두는 쪽 경로가 테스트에서도 실제로 밟힌다.
      Component: ImageViewerLayout,
      children: [{ path, Component, action, loader }, ...routes],
    },
  ]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return {
    user: userEvent.setup(),
    queryClient,
    ...render(
      <Stub
        initialEntries={initialEntries ?? [path]}
        initialIndex={initialIndex}
        hydrationData={hydrationData}
        future={future}
      />,
      {
        ...renderOptions,
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    ),
  };
}

export * from "@testing-library/react";
export { userEvent };
