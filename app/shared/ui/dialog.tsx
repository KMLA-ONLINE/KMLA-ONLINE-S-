import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { XIcon } from "lucide-react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      // Base UI는 중첩된 dialog의 backdrop을 렌더하지 않는다(`enabled: forceRender || !nested`).
      // 스크림이 겹겹이 쌓여 과하게 어두워지는 걸 막으려는 기본값인데, 이 앱은 게시물 상세가
      // 화면을 거의 덮는 불투명 시트라 그 위에 뜬 dialog만 아무 배경도 없이 떠 있는 것처럼
      // 보인다. 10%가 두 겹 겹쳐 봐야 과하지 않다.
      forceRender
      // blur는 쓰지 않는다. 스크림이 별도 합성 레이어가 되면서, 모달이 opacity로 페이드하는
      // 동안 Chrome이 레이어 경계에 1px짜리 가로선을 그렸다 지운다 — 화면을 거의 채우는
      // 모달에서 특히 눈에 띈다. 게다가 `backdrop-blur-xs`는 2px이라 그 대가를 치를 만큼
      // 보이지도 않았다.
      // 스크림 농도는 모드마다 다르다. light의 `--background`와 `--popover`는 둘 다 순백이라
      // 모달을 배경에서 떼어 내는 건 오직 이 스크림이고, 흰 바탕에서는 10%만 깔려도 눈에 띈다.
      // dark의 `--background`는 이미 oklch(0.22)라 같은 10%를 덮어도 sRGB로 2/255밖에 안
      // 움직여 사실상 보이지 않는다 — 검은 스크림을 어두운 바탕에 얹으니 내려갈 자리가 없다.
      // 대신 dark는 `--popover`(0.3)가 배경보다 밝아 분리 자체는 이미 되어 있으므로, 여기서
      // 필요한 일은 뒤에 남은 밝은 본문과 글자를 눌러 주는 쪽이다. 40%면 흰 글자가 L* 98에서
      // 60 근처까지 내려간다. 더 올리지 않는 건 위의 `forceRender` 때문이다 — 두 겹 겹치면
      // 40%는 64%가 되고, 50%는 75%까지 올라 모달 두 장 뒤가 새까매진다.
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 dark:bg-black/40 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) {
  const popupRef = React.useRef<HTMLDivElement>(null);

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        // Base UI는 기본적으로 팝업 안의 첫 tabbable 요소로 포커스를 옮긴다. 열자마자
        // 닫기나 취소 버튼에 포커스 링이 붙어 거절을 권하는 모양이 되므로, 팝업
        // 컨테이너(tabindex=-1)로 보낸다 — 터치로 열렸을 때 Base UI가 하는 동작과 같고,
        // `aria-labelledby` 덕에 버튼 대신 다이얼로그 제목이 읽힌다. 포커스를 아예 끄면
        // (`initialFocus={false}`) 배경이 inert인 트랩 안에 갈 곳이 없어진다.
        // `{...props}`가 뒤에 있으므로 호출부에서 계속 덮어쓸 수 있다.
        ref={popupRef}
        initialFocus={popupRef}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading leading-none font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
