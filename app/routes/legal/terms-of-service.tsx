import { LegalDocument } from "~/features/auth";
import termsOfService from "../../../docs/legal/terms_of_service.md?raw";

export default function TermsOfServicePage() {
  return <LegalDocument markdown={termsOfService} />;
}
