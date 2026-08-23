import { useState } from "react";
import { useFetcher } from "react-router";

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
 * 확인 한 단계를 거치는 로그아웃 버튼.
 *
 * `signOut()`을 직접 부르지 않고 `/logout` route에 submit한다 — 세션을 지운 뒤
 * `/login`으로 보내는 것까지가 그 route의 clientAction이 소유하는 흐름이다.
 * shadcn `AlertDialog`는 이 저장소에서 쓰지 않으므로 `Dialog`로 조립한다.
 */
export function LogoutButton() {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher();

  const pending = fetcher.state !== "idle";

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-full rounded-xl"
        onClick={() => setOpen(true)}
      >
        로그아웃
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // 로그아웃이 이미 날아간 뒤에는 닫아 봐야 redirect가 화면을 갈아 끼운다.
          if (!pending) {
            setOpen(next);
          }
        }}
      >
        <DialogContent className="max-w-xs" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>로그아웃하시겠습니까?</DialogTitle>
          </DialogHeader>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              취소
            </Button>

            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                void fetcher.submit(null, {
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
    </>
  );
}
