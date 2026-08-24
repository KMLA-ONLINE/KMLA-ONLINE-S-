import { Form, Link } from "react-router";

import { formatProfileType } from "~/features/admin/model/format";
import type { AcceptedUser, AdminMember } from "~/features/admin/model/types";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";

type Person = AcceptedUser | AdminMember;

export function AdminSearch({
  query,
  label,
}: {
  query: string;
  label: string;
}) {
  return (
    <Form key={query} method="get" className="flex gap-2" role="search">
      <Input
        name="q"
        defaultValue={query}
        minLength={2}
        placeholder="이름, 공개 ID 또는 기수"
        aria-label={label}
      />
      <Button type="submit" variant="outline">
        검색
      </Button>
    </Form>
  );
}

export function AdminPersonRow({
  person,
  status,
  action,
}: {
  person: Person;
  status?: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/profile/${person.pub_id}`}
            className="font-medium hover:underline"
          >
            {person.name}
          </Link>
          {"is_self" in person && person.is_self ? <Badge>나</Badge> : null}
          {status}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          @{person.pub_id} · {formatProfileType(person.profile_type)} ·{" "}
          {person.cohort ? `${person.cohort}기` : "기수 없음"} ·{" "}
          {person.department || "부서 없음"}
        </p>
      </div>
      {action}
    </li>
  );
}
