import { LegalDocument } from "~/features/auth";
import privacyPolicy from "../../../docs/legal/privacy_policy.md?raw";

export default function PrivacyPolicyPage() {
  return <LegalDocument markdown={privacyPolicy} />;
}
