import type {
  FieldErrors,
  ProfileFormValues,
} from "~/features/auth/model/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 -]{8,20}$/;
const STUDENT_NUMBER_PATTERN = /^[0-9]{6}$/;

export function readFormText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function validateEmail(email: string): string | undefined {
  if (!email) return "이메일을 입력해 주세요.";
  if (!EMAIL_PATTERN.test(email)) return "올바른 이메일 주소를 입력해 주세요.";
}

export function validatePassword(password: string): string | undefined {
  if (!password) return "비밀번호를 입력해 주세요.";
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
}

export function validatePasswordConfirm(
  password: string,
  confirm: string,
): string | undefined {
  if (!confirm) return "비밀번호를 한 번 더 입력해 주세요.";
  if (password !== confirm) return "비밀번호가 일치하지 않습니다.";
}

export function validateOtpCode(otp: string): string | undefined {
  if (!/^\d{6}$/.test(otp)) return "이메일로 받은 숫자 6자리를 입력해 주세요.";
}

export function readProfileForm(formData: FormData): ProfileFormValues {
  return {
    name: readFormText(formData, "name"),
    type: readFormText(formData, "type"),
    studentNumber: readFormText(formData, "studentNumber"),
    classNo: readFormText(formData, "classNo"),
    cohort: readFormText(formData, "cohort"),
    gender: readFormText(formData, "gender"),
    academicTrack: readFormText(formData, "academicTrack"),
    phoneNumber: readFormText(formData, "phoneNumber"),
    birthday: readFormText(formData, "birthday"),
    dormRoom: readFormText(formData, "dormRoom"),
  };
}

function validateOptionalNumber(
  value: string,
  label: string,
  min: number,
  max: number,
): string | undefined {
  if (!value) return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return `${label} 값을 확인해 주세요.`;
  }
}

export function validateProfileForm(values: ProfileFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.name || values.name.length > 50) {
    errors.name = "이름은 1자 이상 50자 이하로 입력해 주세요.";
  }

  if (!(["student", "alumni", "teacher"] as string[]).includes(values.type)) {
    errors.type = "사용자 유형을 선택해 주세요.";
  }

  if (
    values.studentNumber &&
    !STUDENT_NUMBER_PATTERN.test(values.studentNumber)
  ) {
    errors.studentNumber = "학번은 숫자 6자리여야 합니다.";
  }

  if (values.phoneNumber && !PHONE_PATTERN.test(values.phoneNumber)) {
    errors.phoneNumber = "전화번호 형식을 확인해 주세요.";
  }

  // 반과 기숙사 방은 이 폼이 입력받지 않고 기존 값을 실어 나르기만 한다. 화면에 없는
  // 항목의 오류는 사용자가 고칠 방법이 없으므로 여기서 검사하지 않는다.
  errors.cohort = validateOptionalNumber(values.cohort, "기수", 1, 100);

  if (values.type === "student") {
    if (!values.studentNumber) errors.studentNumber = "학번을 입력해 주세요.";
    if (!values.birthday) errors.birthday = "생년월일을 입력해 주세요.";
    if (!values.cohort) errors.cohort = "기수를 입력해 주세요.";
    if (!values.gender) errors.gender = "성별을 선택해 주세요.";
    if (!values.academicTrack) errors.academicTrack = "계열을 선택해 주세요.";
  }

  if (values.type === "alumni") {
    if (!values.cohort) errors.cohort = "기수를 입력해 주세요.";
    if (!values.gender) errors.gender = "성별을 선택해 주세요.";
    if (!values.academicTrack) errors.academicTrack = "계열을 선택해 주세요.";
  }

  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => Boolean(message)),
  );
}

export function hasErrors(errors: object): boolean {
  return Object.values(errors).some(Boolean);
}
