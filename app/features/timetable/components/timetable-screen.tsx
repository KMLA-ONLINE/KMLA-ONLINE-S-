import { useEffect, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { useAppShell } from "~/features/app-shell";
import { CourseMeetingFields } from "~/features/timetable/components/course-meeting-fields";
import { TimetableGrid } from "~/features/timetable/components/timetable-grid";
import {
  loadTimetableRecord,
  saveTimetableRecord,
} from "~/features/timetable/data/timetable";
import {
  COLORS,
  COLOR_DOTS,
  SEMESTERS,
  createMeeting,
  getKoreaWeekday,
  hasScheduleConflict,
  isSemesterKey,
  timetableFromStored,
  type CourseDraft,
  type CourseMeeting,
  type SemesterKey,
  type TimetableCourse,
  type TimetableStorage,
  type Weekday,
} from "~/features/timetable/model/timetable";
import {
  loadTimetable,
  saveTimetable,
} from "~/features/timetable/storage/timetable-storage";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { TextField } from "~/shared/ui/text-field";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

export function TimetableScreen() {
  const { profile } = useAppShell();

  const [timetable, setTimetable] = useState<TimetableStorage>(loadTimetable);

  const activeSemester = timetable.activeSemester;
  const courses = timetable.semesters[activeSemester];

  const [draft, setDraft] = useState<CourseDraft | null>(null);

  const [overlap, setOverlap] = useState(false);

  const today = getKoreaWeekday();

  useEffect(() => {
    let cancelled = false;

    const syncFromDb = async () => {
      try {
        const stored = await loadTimetableRecord(profile.id);

        if (cancelled) {
          return;
        }

        if (stored) {
          const next = timetableFromStored(
            stored.activeSemester,
            stored.semesters,
          );

          setTimetable(next);
          saveTimetable(next);
          return;
        }

        const local = loadTimetable();

        await saveTimetableRecord(
          profile.id,
          local.activeSemester,
          local.semesters,
        );
      } catch (error) {
        console.error("Failed to sync timetable", error);
      }
    };

    const refresh = () => {
      void syncFromDb();
    };

    void syncFromDb();

    window.addEventListener("focus", refresh);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [profile.id]);

  const persistTimetable = (next: TimetableStorage) => {
    setTimetable(next);
    saveTimetable(next);

    void saveTimetableRecord(
      profile.id,
      next.activeSemester,
      next.semesters,
    ).catch((error: unknown) => {
      console.error("Failed to save timetable", error);
    });
  };

  const updateCourses = (next: TimetableCourse[]) => {
    const nextTimetable: TimetableStorage = {
      ...timetable,
      semesters: {
        ...timetable.semesters,
        [activeSemester]: next,
      },
    };

    persistTimetable(nextTimetable);
  };

  const selectSemester = (semester: SemesterKey) => {
    const nextTimetable: TimetableStorage = {
      ...timetable,
      activeSemester: semester,
    };

    persistTimetable(nextTimetable);
    setDraft(null);
    setOverlap(false);
  };

  const openNew = (day: Weekday, period: number) => {
    setOverlap(false);

    setDraft({
      name: "",
      color: courses.length % COLORS.length,
      room: "",
      meetings: [createMeeting(day, period)],
    });
  };

  const openExisting = (course: TimetableCourse) => {
    setOverlap(false);

    setDraft({
      id: course.id,
      name: course.name,
      color: course.color,
      room: course.room,
      meetings: course.meetings.map((meeting) => ({
        ...meeting,
      })),
    });
  };

  const updateMeeting = (id: string, patch: Partial<CourseMeeting>) => {
    if (!draft) {
      return;
    }

    setOverlap(false);

    setDraft({
      ...draft,
      meetings: draft.meetings.map((meeting) =>
        meeting.id === id
          ? {
              ...meeting,
              ...patch,
            }
          : meeting,
      ),
    });
  };

  const addMeeting = () => {
    if (!draft) {
      return;
    }

    const last = draft.meetings.at(-1);

    const nextDay = last ? (((last.day + 1) % 5) as Weekday) : 0;

    setOverlap(false);

    setDraft({
      ...draft,
      meetings: [...draft.meetings, createMeeting(nextDay, 1)],
    });
  };

  const removeMeeting = (id: string) => {
    const current = draft;

    if (!current) {
      return;
    }

    if (current.meetings.length <= 1) {
      return;
    }

    setOverlap(false);

    setDraft({
      ...current,
      meetings: current.meetings.filter((meeting) => meeting.id !== id),
    });
  };

  const save = () => {
    if (!draft?.name.trim()) {
      return;
    }

    if (hasScheduleConflict(draft, courses)) {
      setOverlap(true);
      return;
    }

    const course: TimetableCourse = {
      id: draft.id ?? crypto.randomUUID(),
      name: draft.name.trim(),
      color: draft.color,
      room: draft.room.trim(),
      meetings: draft.meetings,
    };

    const next = draft.id
      ? courses.map((item) => (item.id === draft.id ? course : item))
      : [...courses, course];

    updateCourses(next);
    setDraft(null);
  };

  const removeCourse = () => {
    if (!draft?.id) {
      return;
    }

    updateCourses(courses.filter((course) => course.id !== draft.id));

    setDraft(null);
  };

  return (
    <>
      <div className="flex h-[calc(100dvh-var(--app-page-header-h)-var(--app-safe-t))] min-h-0 w-full flex-col overflow-hidden pb-[calc(1rem+var(--app-safe-b))] md:h-[calc(100dvh-var(--app-header-h)-3rem)] md:pb-0">
        <div className="shrink-0 border-y bg-background px-3 py-2.5">
          <NativeSelect
            aria-label="학기"
            value={activeSemester}
            className="w-full [&>select]:h-10 [&>select]:rounded-xl [&>select]:bg-muted/20 [&>select]:font-medium"
            onChange={(event) => {
              const semester = event.target.value;

              if (isSemesterKey(semester)) {
                selectSemester(semester);
              }
            }}
          >
            {SEMESTERS.map((semester) => (
              <NativeSelectOption key={semester.id} value={semester.id}>
                {semester.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <TimetableGrid
          courses={courses}
          today={today}
          onAddCourse={openNew}
          onSelectCourse={openExisting}
        />
      </div>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
          }
        }}
      >
        {/* 닫기 버튼은 vendored dialog가 기본 padding(p-6)을 전제로 top-4에 박아 둔다.
            여기는 p-4라 32px짜리 버튼이 14px짜리 제목보다 9px 아래로 처진다. */}
        <DialogContent className="max-h-[88dvh] gap-4 overflow-y-auto rounded-2xl p-4 *:data-[slot=dialog-close]:top-2">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "수업 수정" : "수업 추가"}</DialogTitle>
          </DialogHeader>

          {draft ? (
            <>
              <div className="space-y-2">
                <TextField
                  value={draft.name}
                  aria-label="과목명"
                  placeholder="과목명"
                  className="rounded-md px-3 text-base font-medium"
                  onChange={(event) => {
                    setOverlap(false);

                    setDraft({
                      ...draft,
                      name: event.target.value,
                    });
                  }}
                />

                <TextField
                  value={draft.room}
                  aria-label="장소"
                  placeholder="장소"
                  className="rounded-md px-3 text-base"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      room: event.target.value,
                    })
                  }
                />
              </div>

              <div className="grid grid-cols-5 justify-items-center gap-3 px-1">
                {COLOR_DOTS.map((color, colorPosition) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`색상 ${colorPosition + 1}`}
                    aria-pressed={draft.color === colorPosition}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        color: colorPosition,
                      })
                    }
                    className={cn(
                      "size-6 rounded-full transition-transform active:scale-90",
                      color,
                      draft.color === colorPosition &&
                        "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
                    )}
                  />
                ))}
              </div>

              <div className="space-y-2">
                {draft.meetings.map((meeting) => (
                  <CourseMeetingFields
                    key={meeting.id}
                    meeting={meeting}
                    canRemove={draft.meetings.length > 1}
                    onChange={(patch) => updateMeeting(meeting.id, patch)}
                    onRemove={() => removeMeeting(meeting.id)}
                  />
                ))}

                <button
                  type="button"
                  aria-label="시간 추가"
                  onClick={addMeeting}
                  className="flex h-11 w-full items-center justify-center rounded-2xl border border-dashed text-muted-foreground transition-colors active:bg-muted"
                >
                  <PlusIcon className="size-4" />
                </button>
              </div>

              {overlap ? (
                <p className="px-1 text-xs text-destructive">
                  시간상 겹치는 수업이 있습니다
                </p>
              ) : null}

              <DialogFooter className="flex-row items-center">
                {draft.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="수업 삭제"
                    onClick={removeCourse}
                    className="text-destructive"
                  >
                    <Trash2Icon />
                  </Button>
                ) : null}

                <Button
                  type="button"
                  className="ml-auto min-w-20 rounded-xl"
                  disabled={!draft.name.trim()}
                  onClick={save}
                >
                  저장
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
