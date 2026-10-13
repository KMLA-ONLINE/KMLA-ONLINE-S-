import { toast } from "sonner";

export async function copyMessageText(body: string) {
  try {
    await navigator.clipboard.writeText(body);
    toast.success("복사되었습니다.");
  } catch {
    toast.error("메시지를 복사하지 못했습니다.");
  }
}
