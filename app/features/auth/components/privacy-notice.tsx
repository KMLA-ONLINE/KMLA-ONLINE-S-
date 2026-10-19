/**
 * 가입 약관 단계의 개인정보 처리 안내. 문구는 `docs/legal/privacy_notice.md` 1항이 소유하며,
 * 처리방침 2항의 표와 같아야 한다. 읽고 넘어가는 고지라서 "동의"라는 말을 쓰지 않는다.
 *
 * 좁은 화면에서 가로로 밀리지 않도록 표를 항목·내용 목록으로 그린다.
 */
const REQUIRED_ROWS = [
  ["처리 목적", "회원 가입, 학교 구성원 확인, 계정 관리"],
  [
    "처리 항목",
    "이메일, 비밀번호, 이름, 사용자 유형(재학생·졸업생·교사), 학번(재학생), 기수(재학생·졸업생)",
  ],
  ["보유 기간", "탈퇴할 때까지"],
] as const;

const OPTIONAL_ROWS = [
  ["생년월일", "프로필, 생일 목록, 가입 심사 때 구성원·연령 확인"],
  ["성별", "프로필, 같은 기수·같은 성별 회원에게만 보이는 홈 피드 항목"],
  ["계열(국내반·국제반)", "프로필"],
  ["전화번호", "프로필(다른 회원의 연락용)"],
  ["학번(졸업생)", "프로필, 가입 심사 때 구성원 확인"],
] as const;

function NoticeList({
  rows,
}: {
  rows: readonly (readonly [string, string])[];
}) {
  return (
    <dl className="divide-y rounded-lg border text-sm">
      {rows.map(([term, detail]) => (
        <div
          key={term}
          className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3"
        >
          <dt className="shrink-0 font-medium sm:w-36">{term}</dt>
          <dd className="text-muted-foreground">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PrivacyNotice() {
  return (
    <section
      aria-labelledby="privacy-notice-title"
      className="flex flex-col gap-4 text-sm leading-relaxed"
    >
      <h2 id="privacy-notice-title" className="text-base font-semibold">
        개인정보 처리 안내
      </h2>
      <p>
        과학기술부는 KMLA Online 이용계약을 맺고 이행하기 위해 다음 정보를
        처리합니다(「개인정보 보호법」 제15조제1항제4호).
      </p>
      <NoticeList rows={REQUIRED_ROWS} />
      <p>
        가입이 승인되면 이름, 사용자 유형, 기수, 학번은 승인된 다른 회원의
        프로필 화면에 표시됩니다.
      </p>

      <h3 className="font-semibold">선택 정보</h3>
      <p>
        다음 단계의 아래 항목은 입력하지 않아도 가입할 수 있습니다. 입력한
        정보는 가입이 승인된 다른 회원에게 내 프로필에서 보입니다.
      </p>
      <NoticeList rows={OPTIONAL_ROWS} />
      <p>
        입력한 정보는 프로필 편집에서 언제든 고치거나 지울 수 있고, 지우면 바로
        삭제됩니다. 성별을 입력하지 않으면 같은 성별 기준이 적용되는 일부 홈
        피드 항목이 보이지 않을 수 있습니다.
      </p>
      <p>
        자세한 내용은{" "}
        <a
          href="/privacy-policy"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline underline-offset-2"
        >
          개인정보 처리방침
        </a>
        에서 확인할 수 있습니다.
      </p>
    </section>
  );
}
