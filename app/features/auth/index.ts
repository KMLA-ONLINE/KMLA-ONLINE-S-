export { AuthCard } from "~/features/auth/components/auth-card";
export { LegalDocument } from "~/features/auth/components/legal-document";
export { LegalLinks } from "~/features/auth/components/legal-links";
export { LogoutButton } from "~/features/auth/components/logout-button";
export { OtpField } from "~/features/auth/components/otp-field";
export { PasswordField } from "~/features/auth/components/password-field";
export { PrivacyNotice } from "~/features/auth/components/privacy-notice";
export { ProfileFields } from "~/features/auth/components/profile-fields";
export { TermsAgreementDialog } from "~/features/auth/components/terms-agreement-dialog";
export { TermsAgreementField } from "~/features/auth/components/terms-agreement-field";
export {
  agreeToTerms,
  claimSignupPassword,
  resendSignupOtp,
  sendPasswordChangeOtp,
  sendPasswordResetOtp,
  signIn,
  signOut,
  signUp,
  submitProfile,
  updatePassword,
  verifyPasswordResetOtp,
  verifySignupOtp,
} from "~/features/auth/data/mutations";
export {
  hasActiveSession,
  loadAuthState,
  loadMySuspension,
} from "~/features/auth/data/queries";
export { describeSuspensionEnd } from "~/features/auth/model/suspension";
export {
  needsTermsAgreement,
  readTermsAgreement,
  TERMS_VERSION,
} from "~/features/auth/model/terms";
export {
  DUPLICATE_STUDENT_NUMBER_MESSAGE,
  getAuthErrorMessage,
  isDuplicateStudentNumberError,
  isEmailNotConfirmedError,
  isInvalidEmailAddressError,
} from "~/features/auth/model/format";
export {
  clearSignupDraft,
  getSignupDraft,
  saveSignupDraft,
} from "~/features/auth/storage/pending-signup";
export {
  hasErrors,
  readFormText,
  readProfileForm,
  validateEmail,
  validateOtpCode,
  validatePassword,
  validatePasswordConfirm,
  validateProfileForm,
} from "~/features/auth/model/validation";
export {
  getProfileDestination,
  sanitizeLoginNext,
} from "~/features/auth/model/navigation";
export type {
  AuthProfile,
  AuthState,
  FieldErrors,
  MySuspension,
  ProfileFormValues,
} from "~/features/auth/model/types";
export type { SignupDraft } from "~/features/auth/storage/pending-signup";
