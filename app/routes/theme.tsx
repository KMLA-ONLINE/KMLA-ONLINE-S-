import { Link } from "react-router";

import { Badge } from "~/shared/ui/badge";
import { Button, buttonVariants } from "~/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/shared/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { cn } from "~/shared/lib/utils";
import type { Route } from "./+types/theme";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Palette Lab | KMLA Online" },
    {
      name: "description",
      content: "KMLA Online의 라이트·다크 색상 토큰 미리보기",
    },
  ];
}

interface ColorPair {
  name: string;
  background: string;
  foreground: string;
}

const COLOR_PAIRS: ColorPair[] = [
  {
    name: "background / foreground",
    background: "--background",
    foreground: "--foreground",
  },
  {
    name: "card / card-foreground",
    background: "--card",
    foreground: "--card-foreground",
  },
  {
    name: "popover / popover-foreground",
    background: "--popover",
    foreground: "--popover-foreground",
  },
  {
    name: "primary / primary-foreground",
    background: "--primary",
    foreground: "--primary-foreground",
  },
  {
    name: "secondary / secondary-foreground",
    background: "--secondary",
    foreground: "--secondary-foreground",
  },
  {
    name: "muted / muted-foreground",
    background: "--muted",
    foreground: "--muted-foreground",
  },
  {
    name: "accent / accent-foreground",
    background: "--accent",
    foreground: "--accent-foreground",
  },
  {
    name: "destructive / destructive-foreground",
    background: "--destructive",
    foreground: "--destructive-foreground",
  },
];

const SURFACE_COLORS = ["--border", "--input", "--ring"];
const CHART_COLORS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
];
const SIDEBAR_PAIRS: ColorPair[] = [
  {
    name: "sidebar / sidebar-foreground",
    background: "--sidebar",
    foreground: "--sidebar-foreground",
  },
  {
    name: "sidebar-primary / sidebar-primary-foreground",
    background: "--sidebar-primary",
    foreground: "--sidebar-primary-foreground",
  },
  {
    name: "sidebar-accent / sidebar-accent-foreground",
    background: "--sidebar-accent",
    foreground: "--sidebar-accent-foreground",
  },
];
const SIDEBAR_COLORS = ["--sidebar-border", "--sidebar-ring"];

function ColorPairSwatch({ name, background, foreground }: ColorPair) {
  return (
    <div
      className="flex min-h-28 flex-col justify-between rounded-lg border p-4 shadow-xs"
      style={{
        backgroundColor: `var(${background})`,
        borderColor: "color-mix(in oklch, currentColor 14%, transparent)",
        color: `var(${foreground})`,
      }}
    >
      <span className="text-sm font-semibold">Aa 가나다</span>
      <code className="text-xs opacity-80">{name}</code>
    </div>
  );
}

function ColorStrip({ colors }: { colors: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {colors.map((color) => (
        <div className="flex flex-col gap-2" key={color}>
          <div
            className="h-20 rounded-lg border shadow-xs"
            style={{
              backgroundColor: `var(${color})`,
              borderColor: "color-mix(in oklch, currentColor 14%, transparent)",
            }}
          />
          <code className="text-xs text-muted-foreground">{color}</code>
        </div>
      ))}
    </div>
  );
}

function ThemePanel({ mode }: { mode: "light" | "dark" }) {
  const label = mode === "light" ? "Light" : "Dark";

  return (
    <section
      aria-labelledby={`${mode}-theme-title`}
      className={cn(
        mode,
        "min-w-0 rounded-2xl bg-background p-4 text-foreground ring-1 ring-border sm:p-6",
      )}
    >
      <div className="mb-8 flex items-center justify-between border-b border-border pb-4">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Theme specimen
          </p>
          <h2
            className="mt-1 font-heading text-2xl font-semibold"
            id={`${mode}-theme-title`}
          >
            {label}
          </h2>
        </div>
        <div
          className="size-9 rounded-full bg-primary ring-4 ring-ring/20"
          aria-hidden="true"
        />
      </div>

      <div className="flex flex-col gap-10">
        <section aria-labelledby={`${mode}-semantic-title`}>
          <h3
            className="mb-4 text-sm font-semibold"
            id={`${mode}-semantic-title`}
          >
            Semantic pairs
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {COLOR_PAIRS.map((pair) => (
              <ColorPairSwatch key={pair.name} {...pair} />
            ))}
          </div>
        </section>

        <section aria-labelledby={`${mode}-utility-title`}>
          <h3
            className="mb-4 text-sm font-semibold"
            id={`${mode}-utility-title`}
          >
            Border, input & ring
          </h3>
          <ColorStrip colors={SURFACE_COLORS} />
        </section>

        <section aria-labelledby={`${mode}-chart-title`}>
          <h3 className="mb-4 text-sm font-semibold" id={`${mode}-chart-title`}>
            Chart scale
          </h3>
          <ColorStrip colors={CHART_COLORS} />
        </section>

        <section aria-labelledby={`${mode}-sidebar-title`}>
          <h3
            className="mb-4 text-sm font-semibold"
            id={`${mode}-sidebar-title`}
          >
            Sidebar
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {SIDEBAR_PAIRS.map((pair) => (
              <ColorPairSwatch key={pair.name} {...pair} />
            ))}
          </div>
          <div className="mt-3">
            <ColorStrip colors={SIDEBAR_COLORS} />
          </div>
        </section>

        <section aria-labelledby={`${mode}-components-title`}>
          <h3
            className="mb-4 text-sm font-semibold"
            id={`${mode}-components-title`}
          >
            Components & states
          </h3>
          <Card>
            <CardHeader>
              <CardTitle>게시물 미리보기</CardTitle>
              <CardDescription>
                카드, 본문 및 상호작용 색상의 실제 조합입니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p>
                본문 텍스트와{" "}
                <span className="text-muted-foreground">보조 텍스트</span>가
                배경 위에서 어떻게 보이는지 확인하세요.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="ghost">Ghost</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="link">Link</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
              <div className="flex max-w-sm flex-col gap-2">
                <Label htmlFor={`${mode}-email`}>이메일</Label>
                <Input
                  id={`${mode}-email`}
                  type="email"
                  placeholder="name@kmla.kr"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" />}>
                  메뉴 열기
                </DropdownMenuTrigger>
                <DropdownMenuContent className={cn(mode)}>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>게시물 작업</DropdownMenuLabel>
                    <DropdownMenuItem>수정하기</DropdownMenuItem>
                    <DropdownMenuItem>공유하기</DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive">
                      삭제하기
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>
                  다이얼로그 열기
                </DialogTrigger>
                <DialogContent className={cn(mode)}>
                  <DialogHeader>
                    <DialogTitle>shadcn/ui 다이얼로그</DialogTitle>
                    <DialogDescription>
                      설치된 Dialog 컴포넌트가 정상적으로 동작합니다.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose render={<Button />}>확인</DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardFooter>
          </Card>
        </section>
      </div>
    </section>
  );
}

export default function Theme() {
  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-screen-2xl">
        <header className="mb-8 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <Badge variant="secondary">shadcn/ui 적용됨</Badge>
            <p className="mt-3 text-sm font-medium text-primary">
              KMLA Online design system
            </p>
            <h1 className="mt-2 font-heading text-4xl font-semibold tracking-tight text-balance">
              Palette Lab
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-pretty text-muted-foreground">
              모든 semantic, chart, sidebar 색상 토큰을 동일한 조건에서
              비교합니다. 버튼에 마우스를 올리거나 키보드로 포커스해 상태 색상도
              확인할 수 있습니다.
            </p>
          </div>
          <Link className={buttonVariants({ variant: "outline" })} to="/">
            홈으로 돌아가기
          </Link>
        </header>

        <div className="grid items-start gap-6 xl:grid-cols-2">
          <ThemePanel mode="light" />
          <ThemePanel mode="dark" />
        </div>
      </div>
    </main>
  );
}
