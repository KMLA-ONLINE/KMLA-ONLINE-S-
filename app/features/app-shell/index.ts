export { AppHeader } from "~/features/app-shell/components/app-header";
export { AppSidebar } from "~/features/app-shell/components/app-sidebar";
export { MobileTabBar } from "~/features/app-shell/components/mobile-tab-bar";
export { PageHeader } from "~/features/app-shell/components/page-header";
export { ScrollRegion } from "~/features/app-shell/components/scroll-region";
export { loadShellData } from "~/features/app-shell/data/queries";
export {
  DEFAULT_APP_CHROME,
  defineAppChrome,
  resolveAppChrome,
} from "~/features/app-shell/model/chrome";
export {
  AppShellProvider,
  useAppShell,
  useNavBadges,
} from "~/features/app-shell/model/app-shell-context";
export type {
  AppChromeConfig,
  AppChromeHandle,
  ChromeMode,
} from "~/features/app-shell/model/chrome";
export type {
  ProfileRole,
  ProfileStatus,
  ShellData,
  ShellLoadData,
  ShellProfile,
} from "~/features/app-shell/model/types";
