import { render, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, type RoutesTestStubProps } from "react-router";
import type { ComponentType } from "react";

type StubRoutes = Parameters<typeof createRoutesStub>[0];

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
    { path, Component, action, loader },
    ...routes,
  ]);

  return {
    user: userEvent.setup(),
    ...render(
      <Stub
        initialEntries={initialEntries ?? [path]}
        initialIndex={initialIndex}
        hydrationData={hydrationData}
        future={future}
      />,
      renderOptions,
    ),
  };
}

export * from "@testing-library/react";
export { userEvent };
