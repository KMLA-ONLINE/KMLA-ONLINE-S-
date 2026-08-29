import type {
  ProfileAcademicTrack,
  ProfileEditErrors,
  ProfileEditValues,
  ProfileGender,
  ProfileType,
} from "~/features/profiles/model/types";
import { readDateField } from "~/shared/lib/date-field";
import { getSupabase } from "~/shared/supabase/client";

/** `profiles_pub_id_format`와 같은 형식이다. 앞뒤는 영숫자, 전체 5~15자 (§12.1). */
const PUB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{3,13}[a-z0-9]$/;

/**
 * `profiles_pub_id_not_reserved`와 같은 목록. 판정은 제약이 하고 이 목록은 저장을 눌러
 * 보기 전에 알려 주기만 한다. 목록이 뒤처져도 DB가 막고, 그 실패는 필드 오류로 돌아온다.
 */
const RESERVED_PUB_IDS = new Set([
  "admin",
  "administrator",
  "teacher",
  "staff",
  "moderator",
  "support",
  "system",
  "root",
  "sibal",
]);

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readNumber(formData: FormData, key: string): number | null {
  const value = readString(formData, key).trim();
  if (!value) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function readGender(formData: FormData): ProfileGender | null {
  const value = readString(formData, "gender");
  return value === "male" || value === "female" ? value : null;
}

function readAcademicTrack(formData: FormData): ProfileAcademicTrack | null {
  const value = readString(formData, "academicTrack");
  return value === "domestic" || value === "international" ? value : null;
}

export function readProfileEditForm(formData: FormData): ProfileEditValues {
  return {
    pubId: readString(formData, "pubId").trim().toLowerCase(),
    name: readString(formData, "name"),
    description: readString(formData, "description"),
    birthday: readDateField(formData, "birthday"),
    phoneNumber: readString(formData, "phoneNumber"),
    contactEmail: readString(formData, "contactEmail"),
    gender: readGender(formData),
    cohort: readNumber(formData, "cohort"),
    academicTrack: readAcademicTrack(formData),
    department: readString(formData, "department"),
    classNo: readNumber(formData, "classNo"),
    dormRoom: readNumber(formData, "dormRoom"),
    allowTimelinePosts: formData.get("allowTimelinePosts") === "on",
    isReturningStudent: formData.get("isReturningStudent") === "on",
  };
}

function validOptionalInteger(
  value: number | null,
  min: number,
  max: number,
): boolean {
  return (
    value === null ||
    (Number.isInteger(value) &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max)
  );
}

export function validateProfileEdit(
  values: ProfileEditValues,
  type: ProfileType,
): ProfileEditErrors {
  const errors: ProfileEditErrors = {};
  const name = values.name.trim();

  if (!PUB_ID_PATTERN.test(values.pubId)) {
    errors.pubId = "slug는 영문 소문자, 숫자, 하이픈으로 된 5~15자여야 합니다.";
  } else if (RESERVED_PUB_IDS.has(values.pubId)) {
    errors.pubId = "이 slug는 쓸 수 없습니다.";
  }

  if (name.length < 1 || name.length > 50) {
    errors.name = "이름은 1자 이상 50자 이하로 입력해 주세요.";
  }

  if (values.description.length > 500) {
    errors.description = "소개는 최대 500자까지 입력할 수 있습니다.";
  }

  if (values.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(values.birthday)) {
    errors.birthday = "생일 형식을 확인해 주세요.";
  }

  if (type === "student" && !values.birthday) {
    errors.birthday = "재학생은 생일을 입력해야 합니다.";
  }

  const phone = values.phoneNumber.trim();
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (
      !/^\+?[0-9 -]+$/.test(phone) ||
      digits.length < 8 ||
      digits.length > 15
    ) {
      errors.phoneNumber =
        "전화번호를 올바른 형식으로 입력해 주세요. (예: 010-1234-5678)";
    }
  }

  const email = values.contactEmail.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.contactEmail = "이메일 형식을 확인해 주세요.";
  }

  if (type === "student" || type === "alumni") {
    if (!values.gender) errors.gender = "성별을 선택해 주세요.";
    if (!values.academicTrack) {
      errors.academicTrack = "계열을 선택해 주세요.";
    }
    if (
      !validOptionalInteger(values.cohort, 1, 100) ||
      values.cohort === null
    ) {
      errors.cohort = "기수는 1~100 사이의 숫자로 입력해 주세요.";
    }
  }

  if (type === "student") {
    if (values.department.trim().length > 100) {
      errors.department = "부서는 최대 100자까지 입력할 수 있습니다.";
    }
    if (!validOptionalInteger(values.classNo, 1, 10)) {
      errors.classNo = "반은 1~10 사이의 숫자로 입력해 주세요.";
    }
    if (!validOptionalInteger(values.dormRoom, 101, 1008)) {
      errors.dormRoom = "기숙사 방은 101~1008 사이의 숫자로 입력해 주세요.";
    }
  }

  return errors;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * 저장 실패를 폼 오류로 옮긴다.
 *
 * 공개 ID(화면 표기는 slug)가 이미 쓰이는지는 서버만 안다. 그 실패를 폼 상단
 * 문구로 접으면 어디를 고쳐야 하는지 사라지므로 필드 오류로 되돌린다.
 */
export function readProfileEditFailure(error: unknown): ProfileEditErrors {
  const candidate = (error ?? {}) as { code?: string; message?: string };

  if (candidate.code === "23505") {
    return { pubId: "이미 쓰고 있는 slug입니다." };
  }

  if (
    candidate.code === "23514" &&
    candidate.message?.includes("profiles_pub_id")
  ) {
    return { pubId: "쓸 수 없는 slug입니다. 다른 값을 입력해 주세요." };
  }

  return {
    form: "프로필을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.",
  };
}

/** 저장 뒤의 공개 ID를 돌려준다. 공개 ID를 바꾸면 프로필 주소도 함께 바뀐다. */
export async function updateMyProfile(
  values: ProfileEditValues,
): Promise<string> {
  const { data, error } = await getSupabase().rpc("update_my_profile", {
    p_name: values.name.trim(),
    p_description: optional(values.description),
    p_birthday: values.birthday || undefined,
    p_phone_number: optional(values.phoneNumber),
    p_contact_email: optional(values.contactEmail),
    p_gender: values.gender ?? undefined,
    p_cohort: values.cohort ?? undefined,
    p_academic_track: values.academicTrack ?? undefined,
    p_department: optional(values.department),
    p_class_no: values.classNo ?? undefined,
    p_dorm_room: values.dormRoom ?? undefined,
    p_allow_timeline_posts: values.allowTimelinePosts,
    p_is_returning_student: values.isReturningStudent,
    p_pub_id: values.pubId,
  });

  if (error) throw error;

  return data.pub_id;
}
