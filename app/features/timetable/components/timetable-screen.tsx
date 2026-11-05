import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CopyIcon,
  EllipsisIcon,
  EraserIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

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
  COLOR_SHADES,
  courseFromDraft,
  SEMESTERS,
  createMeeting,
  getKoreaWeekday,
  hasScheduleConflict,
  isSemesterKey,
  pasteCourse,
  pasteSemester,
  semesterLabel,
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
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { TextField } from "~/shared/ui/text-field";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

/**
 * 복사해 둔 것. 수업 하나 또는 학기 전체이며 화면을 떠나면 사라진다. 학기를 바꿔도 남아 있어야 다른
 * 학기에 붙일 수 있다.
 */
type TimetableClipboard =
  | { kind: "course"; course: TimetableCourse }
  | { kind: "semester"; semester: SemesterKey; courses: TimetableCourse[] };

function colorPreset(color: number) {
  const preset = COLOR_SHADES.findIndex((shades) => shades.includes(color));
  return preset === -1 ? 0 : preset;
}

export function TimetableScreen() {
  const { profile } = useAppShell();

  const [timetable, setTimetable] = useState<TimetableStorage>(loadTimetable);

  const activeSemester = timetable.activeSemester;
  const courses = timetable.semesters[activeSemester];

  const [draft, setDraft] = useState<CourseDraft | null>(null);
  const [openColorPreset, setOpenColorPreset] = useState<number | null>(null);
  const selectedColorPreset = draft ? colorPreset(draft.color) : null;

  const [overlap, setOverlap] = useState(false);

  const [clipboard, setClipboard] = useState<TimetableClipboard | null>(null);
  const [confirm, setConfirm] = useState<"overwrite" | "clear" | null>(null);

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
    setOpenColorPreset(null);
    setOverlap(false);
  };

  const openNew = (day: Weekday, period: number) => {
    setOverlap(false);
    setOpenColorPreset(null);

    setDraft({
      name: "",
      color: courses.length % COLORS.length,
      room: "",
      meetings: [createMeeting(day, period)],
    });
  };

  const openExisting = (course: TimetableCourse) => {
    setOverlap(false);
    setOpenColorPreset(colorPreset(course.color));

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

    const course = courseFromDraft(draft);

    const next = draft.id
      ? courses.map((item) => (item.id === draft.id ? course : item))
      : [...courses, course];

    updateCourses(next);
    setDraft(null);
  };

  // 저장하지 않은 수정도 창에 보이는 그대로 복사한다. 원래 수업은 창을 닫을 때처럼 그대로 둔다.
  const copyCourse = () => {
    if (!draft?.name.trim()) {
      return;
    }

    setClipboard({ kind: "course", course: courseFromDraft(draft) });
    setDraft(null);
  };

  const copySemester = () => {
    setClipboard({ kind: "semester", semester: activeSemester, courses });
  };

  const paste = () => {
    if (!clipboard) {
      return;
    }

    if (clipboard.kind === "course") {
      const next = pasteCourse(courses, clipboard.course);
      if (!next) {
        toast.error("시간이 겹치는 수업이 있어 붙여 넣지 못했습니다.");
        return;
      }
      updateCourses(next);
      toast.success(`‘${clipboard.course.name}’ 붙여넣음`);
      return;
    }

    // 학기 전체는 지금 학기를 바꿔 넣으므로, 수업이 있으면 먼저 묻는다.
    if (courses.length > 0) {
      setConfirm("overwrite");
      return;
    }
    pasteWholeSemester(clipboard);
  };

  const pasteWholeSemester = (
    copied: Extract<TimetableClipboard, { kind: "semester" }>,
  ) => {
    updateCourses(pasteSemester(copied.courses));
    toast.success(`${semesterLabel(copied.semester)} 시간표 붙여넣음`);
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
        <div className="flex shrink-0 items-center gap-2 border-y bg-background px-3 py-2.5">
          <NativeSelect
            aria-label="학기"
            value={activeSemester}
            className="min-w-0 flex-1 [&>select]:h-10 [&>select]:rounded-xl [&>select]:bg-muted/20 [&>select]:font-medium"
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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 rounded-xl text-muted-foreground"
                  aria-label="학기 메뉴"
                />
              }
            >
              <EllipsisIcon aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem
                className="cursor-pointer"
                disabled={courses.length === 0}
                onClick={copySemester}
              >
                <CopyIcon aria-hidden />이 학기 시간표 복사
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                className="cursor-pointer"
                disabled={courses.length === 0}
                onClick={() => setConfirm("clear")}
              >
                <EraserIcon aria-hidden />이 학기 비우기
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <TimetableGrid
          courses={courses}
          today={today}
          onAddCourse={openNew}
          onSelectCourse={openExisting}
        />

        {clipboard ? (
          // 복사해 둔 것과 붙여넣기. 학기를 바꿔도 남아 있어 다른 학기에 붙일 수 있다.
          <div className="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-xl border bg-muted/40 py-1.5 pr-1.5 pl-3">
            <p role="status" className="min-w-0 flex-1 truncate text-sm">
              {clipboard.kind === "course"
                ? `‘${clipboard.course.name}’ 복사됨`
                : `${semesterLabel(clipboard.semester)} 시간표 복사됨`}
            </p>
            <Button
              type="button"
              size="sm"
              className="shrink-0 rounded-lg"
              onClick={paste}
            >
              붙여넣기
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground"
              aria-label="복사 취소"
              onClick={() => setClipboard(null)}
            >
              <XIcon aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      {confirm === "overwrite" && clipboard?.kind === "semester" ? (
        <ConfirmDialog
          title={`${semesterLabel(activeSemester)} 시간표를 덮어쓸까요?`}
          description={`지금 있는 수업 ${courses.length}개가 지워지고 ${semesterLabel(clipboard.semester)} 시간표로 바뀝니다.`}
          confirmLabel="덮어쓰기"
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            pasteWholeSemester(clipboard);
            setConfirm(null);
          }}
        />
      ) : null}

      {confirm === "clear" ? (
        <ConfirmDialog
          title={`${semesterLabel(activeSemester)} 시간표를 비울까요?`}
          description={`수업 ${courses.length}개가 모두 지워집니다.`}
          confirmLabel="비우기"
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            updateCourses([]);
            setConfirm(null);
          }}
        />
      ) : null}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
            setOpenColorPreset(null);
          }
        }}
      >
        {/* vendored dialog의 닫기 버튼은 p-6 기준 top-4라, p-4인 여기서는 제목보다 처진다. */}
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

              <div className="space-y-1">
                <div className="grid grid-cols-5 justify-items-center gap-1 px-1">
                  {COLOR_DOTS.map((color, colorPosition) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`색상 ${colorPosition + 1}`}
                      aria-expanded={openColorPreset === colorPosition}
                      aria-controls={
                        openColorPreset === colorPosition
                          ? "timetable-color-shades"
                          : undefined
                      }
                      onClick={() => {
                        setDraft({ ...draft, color: colorPosition });
                        setOpenColorPreset(colorPosition);
                      }}
                      className="flex size-10 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className={cn(
                          "size-7 rounded-full border border-foreground/10",
                          selectedColorPreset === colorPosition
                            ? (COLORS[draft.color] ?? color)
                            : color,
                          selectedColorPreset === colorPosition &&
                            "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
                        )}
                      />
                    </button>
                  ))}
                </div>
                {openColorPreset !== null ? (
                  <div
                    id="timetable-color-shades"
                    role="group"
                    aria-label={`색상 ${openColorPreset + 1} 밝기`}
                    className="grid grid-cols-5 justify-items-center gap-1 px-1"
                  >
                    {COLOR_SHADES[openColorPreset].map((color, position) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`밝기 ${position + 1}`}
                        aria-pressed={draft.color === color}
                        onClick={() => setDraft({ ...draft, color })}
                        className="flex size-10 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span
                          className={cn(
                            "size-7 rounded-full border border-foreground/10",
                            COLORS[color],
                            draft.color === color &&
                              "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
                          )}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
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
                  시간이 겹치는 수업이 있습니다.
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

                {/* 바로 지워지는 삭제 버튼과 붙어 있으면 잘못 누르기 쉬워 복사는 저장 쪽에 둔다. */}
                <div className="ml-auto flex items-center gap-2">
                  {draft.id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="수업 복사"
                      disabled={!draft.name.trim()}
                      onClick={copyCourse}
                    >
                      <CopyIcon />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    className="min-w-20 rounded-xl"
                    disabled={!draft.name.trim()}
                    onClick={save}
                  >
                    저장
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
