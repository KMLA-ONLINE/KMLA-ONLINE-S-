import { toast } from "sonner";

export async function copyMessageText(body: string) {
  try {
    await navigator.clipboard.writeText(body);
  } catch {
    toast.error("메시지를 복사하지 못했습니다.");
  }
}
