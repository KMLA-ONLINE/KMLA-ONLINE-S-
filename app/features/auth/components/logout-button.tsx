import { LogOutIcon } from "lucide-react";
import { useState, type RefObject } from "react";
import { useNavigation, useSubmit } from "react-router";

import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

/**
 * `/logout` route에 submit하는 확인 단계 포함 로그아웃 버튼.
 * shadcn `AlertDialog`는 저장소에서 쓰지 않아 `Dialog`로 조립한다.
 */
export function LogoutButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        className="h-11 w-full rounded-xl"
        onClick={() => setOpen(true)}
      >
        <LogOutIcon aria-hidden />
        로그아웃
      </Button>

      <LogoutDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** 드롭다운이 닫혀도 확인창은 유지되도록 트리거와 분리한다. */
export function LogoutDialog({
  open,
  onOpenChange,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const pending =
    navigation.state !== "idle" && navigation.formAction === "/logout";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 로그아웃이 이미 날아간 뒤에는 닫아 봐야 redirect가 화면을 갈아 끼운다.
        if (!pending) {
          onOpenChange(next);
        }
      }}
    >
      <DialogContent
        className="max-w-xs"
        showCloseButton={false}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>로그아웃하시겠습니까?</DialogTitle>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>

          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              // 세션 정리가 다이얼로그를 unmount해도 redirect가 유지되도록 navigation으로 제출한다.
              void submit(null, {
                method: "post",
                action: "/logout",
              });
            }}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            로그아웃
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
