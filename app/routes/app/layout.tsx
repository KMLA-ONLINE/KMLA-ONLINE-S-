import { useRef } from "react";
import { Outlet, useMatches } from "react-router";

import {
  AppHeader,
  AppSidebar,
  MobileTabBar,
  resolveAppChrome,
  ScrollRegion,
} from "~/features/app-shell";
import { useHideOnScroll } from "~/shared/hooks/use-hide-on-scroll";
import { cn } from "~/shared/lib/utils";

export default function MainAppLayout() {
  const matches = useMatches();
  const chrome = resolveAppChrome(matches);
  const scrollRef = useRef<HTMLElement>(null);
  const hidden = useHideOnScroll({
    containerRef: scrollRef,
    enabled:
      chrome.header === "hide-on-scroll" ||
      chrome.bottomNav === "hide-on-scroll",
  });

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {chrome.header === "none" ? null : (
        <AppHeader
          className={cn(
            "max-md:hidden",
            chrome.header === "hide-on-scroll" &&
              "transition-[margin,transform] duration-200 ease-out motion-reduce:transition-none md:focus-within:mt-0 md:focus-within:translate-y-0",
            chrome.header === "hide-on-scroll" &&
              hidden &&
              "md:-mt-[var(--app-header-h)] md:-translate-y-full",
          )}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <AppSidebar className="max-md:hidden" />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ScrollRegion scrollRef={scrollRef}>
            <div className="md:px-8">
              <div className="mx-auto w-full max-w-3xl md:py-6">
                <Outlet />
              </div>
            </div>
          </ScrollRegion>

          {chrome.bottomNav === "none" ? null : (
            <MobileTabBar
              className={cn(
                "md:hidden",
                chrome.bottomNav === "hide-on-scroll" &&
                  "transition-[margin,transform] duration-200 ease-out focus-within:mb-0 focus-within:translate-y-0 motion-reduce:transition-none",
                chrome.bottomNav === "hide-on-scroll" &&
                  hidden &&
                  "max-md:-mb-[calc(var(--app-tabbar-h)+var(--app-safe-b))] max-md:translate-y-full",
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
