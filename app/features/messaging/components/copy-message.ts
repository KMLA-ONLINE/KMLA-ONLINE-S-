import { toast } from "sonner";

import { getCurrentLocale, translate } from "~/shared/i18n";

export async function copyMessageText(body: string) {
  try {
    await navigator.clipboard.writeText(body);
    toast.success(translate(getCurrentLocale(), "복사되었습니다."));
  } catch {
    toast.error(translate(getCurrentLocale(), "메시지를 복사하지 못했습니다."));
  }
}
