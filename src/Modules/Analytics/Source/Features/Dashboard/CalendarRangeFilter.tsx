import { DayPicker, TZDate, type DateRange } from "@daypicker/react";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import "@daypicker/react/style.css";

import { REPORT_TIMEZONE, type CalendarRange } from "../ReportContract/types";
import { calendarPreset, readCalendarDraft, type CalendarPreset } from "./calendar-draft";
import { formatCalendarRange } from "./format";

const wideCalendar = "(min-width: 720px)";
const presets: ReadonlyArray<[CalendarPreset, string]> = [
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["month", "This month"],
];

function subscribeWideCalendar(notify: () => void) {
  const media = window.matchMedia(wideCalendar);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

const isWide = () => window.matchMedia(wideCalendar).matches;
const isWideOnServer = () => false;

function pickerDate(value: string): TZDate {
  const [year, month, day] = value.split("-").map(Number);
  const date = new TZDate(2000, 0, 1, REPORT_TIMEZONE);
  date.setFullYear(year, month - 1, day);
  return date;
}

function localDate(date: Date) {
  const local = TZDate.tz(REPORT_TIMEZONE, date.getTime());
  return `${String(local.getFullYear()).padStart(4, "0")}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

type Props = { value: CalendarRange; onApply: (value: CalendarRange) => void };

export function CalendarRangeFilter({ value, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const label = formatCalendarRange(value.from, value.to);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="analytics-date-trigger"
        aria-label={`Date range: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(true)}
      >
        <CalendarDays size={16} aria-hidden="true" /> <span>{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <CalendarDialog
          id={id}
          value={value}
          onApply={onApply}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}

function CalendarDialog({
  id,
  value,
  onApply,
  onClose,
}: Props & { id: string; onClose: () => void }) {
  const [today] = useState(() => new Date());
  const lastDate = calendarPreset("30", today).to;
  const [draft, setDraft] = useState(value);
  const [awaitingEnd, setAwaitingEnd] = useState(false);
  const [month, setMonth] = useState<Date>(() => pickerDate(value.from));
  const wide = useSyncExternalStore(subscribeWideCalendar, isWide, isWideOnServer);
  const dialog = useRef<HTMLDialogElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const applyButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    firstInput.current?.focus();
  }, []);

  const valid = readCalendarDraft(draft.from, draft.to, today);
  const validStart = readCalendarDraft(draft.from, draft.from, today);
  const selected: DateRange | undefined = validStart
    ? {
        from: pickerDate(draft.from),
        to: valid && !awaitingEnd ? pickerDate(draft.to) : undefined,
      }
    : undefined;

  function selectDays(next: DateRange) {
    if (!next.from) return;
    const from = localDate(next.from);
    setAwaitingEnd(!next.to);
    // The first day is immediately applicable as a one-day range while awaiting a second click.
    setDraft({ ...draft, from, to: next.to ? localDate(next.to) : from });
  }

  function updateInput(key: "from" | "to", date: string) {
    setAwaitingEnd(false);
    setDraft({ ...draft, [key]: date });
    if (key === "from" && readCalendarDraft(date, date, today))
      setMonth(pickerDate(date));
  }

  function applyPreset(preset: CalendarPreset) {
    const range = calendarPreset(preset, today);
    setAwaitingEnd(false);
    setDraft(range);
    setMonth(pickerDate(range.from));
  }

  return (
    <dialog
      id={id}
      ref={dialog}
      className="analytics-calendar"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab") {
          return;
        }
        const first = closeButton.current;
        const last = valid ? applyButton.current : cancelButton.current;
        // Chromium can move from the last dialog control to browser chrome.
        if (
          (event.shiftKey && event.target === first) ||
          (!event.shiftKey && event.target === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onApply({ from: valid.from, to: valid.to, timezone: valid.timezone });
          dialog.current?.close();
        }}
      >
        <div className="analytics-calendar-heading">
          <div>
            <h2 id={`${id}-title`}>Choose a date range</h2>
            <p>All reports use the store timezone, Eastern Time.</p>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="analytics-close"
            aria-label="Close date picker"
            onClick={() => dialog.current?.close()}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="analytics-calendar-dates">
          <label>
            Start date
            <input
              ref={firstInput}
              type="date"
              value={draft.from}
              max={lastDate}
              onChange={(event) => updateInput("from", event.target.value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={draft.to}
              max={lastDate}
              onChange={(event) => updateInput("to", event.target.value)}
            />
          </label>
        </div>
        <div
          className="analytics-calendar-presets"
          aria-label="Date presets"
          role="group"
        >
          {presets.map(([preset, label]) => {
            const range = calendarPreset(preset, today);
            return (
              <button
                type="button"
                key={preset}
                aria-pressed={range.from === draft.from && range.to === draft.to}
                onClick={() => applyPreset(preset)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="analytics-calendar-grid">
          <p>Select dates on the calendar or enter them above.</p>
          <DayPicker
            mode="range"
            required
            resetOnSelect
            min={0}
            timeZone={REPORT_TIMEZONE}
            month={month}
            onMonthChange={setMonth}
            numberOfMonths={wide ? 2 : 1}
            today={pickerDate(lastDate)}
            endMonth={pickerDate(lastDate)}
            disabled={{ after: pickerDate(lastDate) }}
            selected={selected}
            onSelect={selectDays}
          />
        </div>
        <div className="analytics-calendar-footer">
          <div role="status">
            {valid ? (
              <>
                <p>{formatCalendarRange(valid.from, valid.to)}</p>
                <p>
                  {valid.calendarDays} inclusive{" "}
                  {valid.calendarDays === 1 ? "day" : "days"}
                </p>
              </>
            ) : (
              <p>Enter an ordered range ending on or before today.</p>
            )}
          </div>
          <div className="analytics-calendar-actions">
            <button
              ref={cancelButton}
              type="button"
              className="admin-button-secondary"
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button
              ref={applyButton}
              type="submit"
              className="admin-button-primary"
              disabled={!valid}
            >
              Apply range
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
